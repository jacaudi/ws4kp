package proxy

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// testIdle stands in for the 15 s idle timeout.
const testIdle = 200 * time.Millisecond

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (f *fakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

func (f *fakeClock) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

// msgHandler records every log message on a buffered channel.
type msgHandler struct{ msgs chan string }

func (h msgHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h msgHandler) Handle(_ context.Context, r slog.Record) error {
	select {
	case h.msgs <- r.Message:
	default:
	}
	return nil
}
func (h msgHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h msgHandler) WithGroup(string) slog.Handler      { return h }

// harness is a cache in front of a fake upstream, mounted at /api/ (text) and /radar/
// (binary), both proxying to the same httptest server.
type harness struct {
	t     *testing.T
	srv   *httptest.Server
	clock *fakeClock
	cache *Cache
	mux   *http.ServeMux
	msgs  chan string

	mu      sync.Mutex
	handler http.HandlerFunc
	hits    int
	seen    []*http.Request
}

func newHarness(t *testing.T, handler http.HandlerFunc) *harness {
	t.Helper()
	h := &harness{t: t, clock: &fakeClock{t: time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)}, handler: handler, msgs: make(chan string, 256)}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.hits++
		h.seen = append(h.seen, r.Clone(context.Background()))
		next := h.handler
		h.mu.Unlock()
		next(w, r)
	}))
	t.Cleanup(h.srv.Close)
	h.cache = New(slog.New(msgHandler{h.msgs}), WithIdleTimeout(testIdle), WithClock(h.clock.Now))
	h.mux = http.NewServeMux()
	h.mux.Handle("/api/", h.cache.Handler(Upstream{Mount: "/api/", Base: h.srv.URL, Service: "Weather.gov", SkipParams: []string{"u"}}))
	h.mux.Handle("/radar/", h.cache.Handler(Upstream{Mount: "/radar/", Base: h.srv.URL, Service: "Radar", Binary: always}))
	return h
}

func (h *harness) setHandler(handler http.HandlerFunc) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.handler = handler
}

func (h *harness) hitCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.hits
}

func (h *harness) lastSeen() *http.Request {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.seen[len(h.seen)-1]
}

func (h *harness) do(method, target string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(h.t.Context(), method, target, nil)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, r)
	return w
}

func (h *harness) get(target string) *httptest.ResponseRecorder {
	return h.do(http.MethodGet, target, nil)
}

// reply returns an upstream handler that sends status, body and the given headers.
func reply(status int, body string, header ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		for i := 0; i+1 < len(header); i += 2 {
			w.Header().Set(header[i], header[i+1])
		}
		w.WriteHeader(status)
		if _, err := w.Write([]byte(body)); err != nil {
			return
		}
	}
}

func expect(t *testing.T, w *httptest.ResponseRecorder, status int, body, cacheControl string) {
	t.Helper()
	if w.Code != status {
		t.Errorf("status = %d, want %d", w.Code, status)
	}
	if got := w.Body.String(); got != body {
		t.Errorf("body = %q, want %q", got, body)
	}
	if got := w.Header().Get("Cache-Control"); got != cacheControl {
		t.Errorf("Cache-Control = %q, want %q", got, cacheControl)
	}
}

const jsonCT = "application/json; charset=utf-8"

func TestFreshHitIsServedFromTheCache(t *testing.T) {
	h := newHarness(t, reply(200, `{"v":1}`, "Cache-Control", "max-age=60", "Content-Type", "application/geo+json"))
	expect(t, h.get("/api/points/1"), 200, `{"v":1}`, ClientCacheControl)
	h.clock.Advance(59 * time.Second)
	w := h.get("/api/points/1")
	expect(t, w, 200, `{"v":1}`, ClientCacheControl)
	if got := w.Header().Get("Content-Type"); got != "application/geo+json; charset=utf-8" {
		t.Errorf("cached Content-Type = %q", got)
	}
	if h.hitCount() != 1 {
		t.Errorf("upstream hits = %d, want 1", h.hitCount())
	}
}

func TestFreshness(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	lm := func(ago time.Duration) string { return now.Add(-ago).Format(http.TimeFormat) }
	tests := []struct {
		name   string
		header http.Header
		want   time.Duration
	}{
		{"max-age", http.Header{"Cache-Control": {"public, max-age=60"}}, 60 * time.Second},
		{"s-maxage over max-age", http.Header{"Cache-Control": {"max-age=60, s-maxage=5"}}, 5 * time.Second},
		{"case-insensitive", http.Header{"Cache-Control": {"MAX-AGE=7"}}, 7 * time.Second},
		{"split across header lines", http.Header{"Cache-Control": {"public", "max-age=9"}}, 9 * time.Second},
		{"max-age=0 falls through to the heuristic", http.Header{"Cache-Control": {"max-age=0"}, "Last-Modified": {lm(20 * time.Hour)}}, 2 * time.Hour},
		{"s-maxage=0 hides max-age and falls through", http.Header{"Cache-Control": {"s-maxage=0, max-age=60"}, "Last-Modified": {lm(20 * time.Hour)}}, 2 * time.Hour},
		{"heuristic clamped low", http.Header{"Last-Modified": {lm(time.Minute)}}, time.Hour},
		{"heuristic clamped high", http.Header{"Last-Modified": {lm(10 * 24 * time.Hour)}}, 4 * time.Hour},
		{"Last-Modified in the future", http.Header{"Last-Modified": {now.Add(time.Hour).Format(http.TimeFormat)}}, 0},
		{"invalid Last-Modified is not cached (D6)", http.Header{"Last-Modified": {"yesterday-ish"}}, 0},
		{"no-store is not honored", http.Header{"Cache-Control": {"no-store, max-age=60"}}, 60 * time.Second},
		{"nothing to go on", http.Header{}, 0},
		{"a lifetime too long to represent is capped", http.Header{"Cache-Control": {"max-age=99999999999999999999"}}, maxFreshness * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := freshness(tt.header, now); got != tt.want {
				t.Errorf("freshness = %v, want %v", got, tt.want)
			}
		})
	}
}

// One test per row of the design's §5.3 response table, after a cacheable first response
// where the row needs a stale copy.
func TestResponseTable(t *testing.T) {
	primed := reply(200, "old", "Cache-Control", "max-age=60", "Etag", `"v1"`)
	tests := []struct {
		name        string
		stale       bool
		upstream    http.HandlerFunc
		wantStatus  int
		wantBody    string
		wantCC      string
		wantCachedX bool // a follow-up request is answered without reaching upstream
	}{
		{"2xx is sent and cached", false, reply(200, "new", "Cache-Control", "max-age=60"), 200, "new", ClientCacheControl, true},
		{"304 with stale and max-age refreshes the entry", true, reply(304, "", "Cache-Control", "max-age=60"), 200, "old", ClientCacheControl, true},
		{"304 with stale and no max-age serves it unrefreshed", true, reply(304, ""), 200, "old", ClientCacheControl, false},
		{"304 without stale is an inconsistency", false, reply(304, ""), 500, `{"error":"Cache inconsistency error"}`, "", false},
		{"4xx is passed through and not cached", false, reply(404, "nope", "Cache-Control", "max-age=60"), 404, "nope", ClientCacheControl, false},
		{"5xx with stale serves the stale copy", true, reply(503, "down"), 200, "old", ClientCacheControl, false},
		{"5xx without stale is passed through", false, reply(503, "down"), 503, "down", ClientCacheControl, false},
		{"header timeout with stale serves the stale copy", true, stall(nil), 200, "old", ClientCacheControl, false},
		{"header timeout without stale is 504", false, stall(nil), 504, `{"error":"Gateway timeout"}`, "", false},
		{"body stall without stale is 504", false, stall([]byte("partial")), 504, `{"error":"Gateway timeout"}`, "", false},
		{"body stall with stale serves the stale copy", true, stall([]byte("partial")), 200, "old", ClientCacheControl, false},
		{"body stream error is 500", false, truncated(t), 500, `{"error":"Stream error: unexpected EOF"}`, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, primed)
			if tt.stale {
				h.get("/api/x")
				h.clock.Advance(61 * time.Second)
			}
			h.setHandler(tt.upstream)
			w := h.get("/api/x")
			expect(t, w, tt.wantStatus, tt.wantBody, tt.wantCC)
			if tt.wantCC == "" && w.Header().Get("Content-Type") != jsonCT {
				t.Errorf("error Content-Type = %q, want %q", w.Header().Get("Content-Type"), jsonCT)
			}
			hits := h.hitCount()
			h.setHandler(reply(200, "later"))
			h.get("/api/x")
			if cached := h.hitCount() == hits; cached != tt.wantCachedX {
				t.Errorf("follow-up served from cache = %v, want %v", cached, tt.wantCachedX)
			}
		})
	}
}

// stall writes headers and then body (when non-nil), and then sends nothing until the test ends.
func stall(body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if body != nil {
			w.Header().Set("Content-Length", "1000")
			w.WriteHeader(200)
			if _, err := w.Write(body); err != nil {
				return
			}
			if err := http.NewResponseController(w).Flush(); err != nil {
				return
			}
		}
		<-r.Context().Done()
	}
}

// truncated promises 1000 bytes, sends 7 and closes the connection.
func truncated(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		conn, buf, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_, err = buf.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\npartial")
		if err == nil {
			err = buf.Flush()
		}
		if err := errors.Join(err, conn.Close()); err != nil {
			t.Error(err)
		}
	}
}

func TestConnectionError(t *testing.T) {
	t.Run("without stale", func(t *testing.T) {
		h := newHarness(t, reply(200, "x"))
		h.srv.Close()
		expect(t, h.get("/api/x"), 500, `{"error":"Failed to fetch data from Weather.gov"}`, "")
	})
	t.Run("with stale", func(t *testing.T) {
		h := newHarness(t, reply(200, "old", "Cache-Control", "max-age=60"))
		h.get("/api/x")
		h.clock.Advance(61 * time.Second)
		h.srv.Close()
		expect(t, h.get("/api/x"), 200, "old", ClientCacheControl)
	})
}

func TestSlowButProgressingBodyIsNotCutOff(t *testing.T) {
	h := newHarness(t, func(w http.ResponseWriter, _ *http.Request) {
		rc := http.NewResponseController(w)
		for i := range 6 { // 6 x testIdle/2 = 3 idle periods in total, never one in a row
			if _, err := w.Write([]byte{'a' + byte(i)}); err != nil {
				return
			}
			if err := rc.Flush(); err != nil {
				return
			}
			time.Sleep(testIdle / 2)
		}
	})
	expect(t, h.get("/api/slow"), 200, "abcdef", ClientCacheControl)
}

func TestRevalidationHeaders(t *testing.T) {
	tests := []struct {
		name       string
		validators []string
		wantINM    string
		wantIMS    string
	}{
		{"etag wins", []string{"Etag", `"v1"`, "Last-Modified", "Mon, 19 Oct 2026 12:00:00 GMT"}, `"v1"`, ""},
		{"last-modified when there is no etag", []string{"Last-Modified", "Mon, 19 Oct 2026 12:00:00 GMT"}, "", "Mon, 19 Oct 2026 12:00:00 GMT"},
		{"neither", nil, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, reply(200, "old", append([]string{"Cache-Control", "max-age=60"}, tt.validators...)...))
			h.get("/api/x")
			h.clock.Advance(61 * time.Second)
			h.get("/api/x")
			seen := h.lastSeen()
			if got := seen.Header.Get("If-None-Match"); got != tt.wantINM {
				t.Errorf("If-None-Match = %q, want %q", got, tt.wantINM)
			}
			if got := seen.Header.Get("If-Modified-Since"); got != tt.wantIMS {
				t.Errorf("If-Modified-Since = %q, want %q", got, tt.wantIMS)
			}
		})
	}
}

// TestInFlight holds the first upstream request open until a second request for the same
// key is waiting on it.
func TestInFlight(t *testing.T) {
	tests := []struct {
		name     string
		header   []string
		wantHits int
	}{
		{"waiter is served the fresh result", []string{"Cache-Control", "max-age=60"}, 1},
		{"waiter makes its own request when the result is not cacheable", nil, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			release := make(chan struct{})
			arrived := make(chan struct{}, 2)
			h := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
				arrived <- struct{}{}
				<-release
				reply(200, "shared", tt.header...)(w, r)
			})
			var wg sync.WaitGroup
			results := make([]*httptest.ResponseRecorder, 2)
			wg.Go(func() { results[0] = h.get("/api/x") })
			<-arrived
			wg.Go(func() { results[1] = h.get("/api/x") })
			for msg := range h.msgs {
				if msg == "proxy wait" {
					break
				}
			}
			close(release)
			wg.Wait()
			for i, w := range results {
				if w.Code != 200 || w.Body.String() != "shared" {
					t.Errorf("request %d = %d %q, want 200 \"shared\"", i, w.Code, w.Body.String())
				}
			}
			if got := h.hitCount(); got != tt.wantHits {
				t.Errorf("upstream hits = %d, want %d", got, tt.wantHits)
			}
		})
	}
}

func TestRequestShaping(t *testing.T) {
	tests := []struct {
		name       string
		target     string
		accept     string
		wantPath   string
		wantQuery  string
		wantAccept string
	}{
		{"skip params are dropped", "/api/x?u=1&b=2", "", "/x", "b=2", "*/*"},
		{"a repeated key is comma-joined", "/api/x?a=1&a=2", "", "/x", "a=1%2C2", "*/*"},
		{"the escaped path is passed through", "/api/points/28.5%2C-81.4", "", "/points/28.5%2C-81.4", "", "*/*"},
		{"accept is copied", "/api/x", "application/geo+json", "/x", "", "application/geo+json"},
		{"no query when every param is skipped", "/api/x?u=1", "", "/x", "", "*/*"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, reply(200, "ok"))
			header := map[string]string{}
			if tt.accept != "" {
				header["Accept"] = tt.accept
			}
			h.do(http.MethodHead, tt.target, header)
			seen := h.lastSeen()
			if seen.Method != http.MethodGet {
				t.Errorf("upstream method = %s, want GET", seen.Method)
			}
			if got := seen.URL.EscapedPath(); got != tt.wantPath {
				t.Errorf("upstream path = %q, want %q", got, tt.wantPath)
			}
			if seen.URL.RawQuery != tt.wantQuery {
				t.Errorf("upstream query = %q, want %q", seen.URL.RawQuery, tt.wantQuery)
			}
			if got := seen.Header.Get("Accept"); got != tt.wantAccept {
				t.Errorf("upstream Accept = %q, want %q", got, tt.wantAccept)
			}
			if got := seen.Header.Get("User-Agent"); got != UserAgent {
				t.Errorf("upstream User-Agent = %q", got)
			}
			if got := seen.Header.Get("Accept-Encoding"); got != "" {
				t.Errorf("upstream Accept-Encoding = %q, want none (Node sent none)", got)
			}
		})
	}
}

func TestRedirectIsPassedThroughNotFollowed(t *testing.T) {
	h := newHarness(t, reply(302, "", "Location", "/elsewhere"))
	w := h.get("/api/x")
	if w.Code != 302 || w.Header().Get("Location") != "/elsewhere" {
		t.Errorf("got %d Location %q, want 302 /elsewhere", w.Code, w.Header().Get("Location"))
	}
	if h.hitCount() != 1 {
		t.Errorf("upstream hits = %d, want 1 (the redirect was followed)", h.hitCount())
	}
}

func TestContentType(t *testing.T) {
	tests := []struct {
		name, target, upstreamType, want string
	}{
		{"text mode adds a charset", "/api/x", "application/geo+json", "application/geo+json; charset=utf-8"},
		{"text mode replaces a non-utf-8 charset", "/api/x", "text/html; charset=ISO-8859-1", "text/html; charset=utf-8"},
		{"text mode defaults to html", "/api/x", "", "text/html; charset=utf-8"},
		{"binary mode defaults to octet-stream", "/radar/x.png", "", "application/octet-stream"},
		{"binary mode keeps the upstream type", "/radar/x.png", "image/png", "image/png"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, func(w http.ResponseWriter, _ *http.Request) {
				if tt.upstreamType == "" {
					w.Header()["Content-Type"] = nil // stop net/http sniffing one
				} else {
					w.Header().Set("Content-Type", tt.upstreamType)
				}
				if _, err := w.Write([]byte("body")); err != nil {
					return
				}
			})
			if got := h.get(tt.target).Header().Get("Content-Type"); got != tt.want {
				t.Errorf("Content-Type = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestWeakETagAnswers304(t *testing.T) {
	h := newHarness(t, reply(200, "blob", "Cache-Control", "max-age=60"))
	first := h.get("/radar/x.png")
	etag := first.Header().Get("Etag")
	if !strings.HasPrefix(etag, `W/"`) {
		t.Fatalf("ETag = %q, want a weak validator", etag)
	}
	w := h.do(http.MethodGet, "/radar/x.png", map[string]string{"If-None-Match": etag})
	if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
		t.Errorf("revalidation = %d with %d body bytes, want 304 and none", w.Code, w.Body.Len())
	}
}

// Ported from web/tests/unit/cache-headers.test.mjs.
func TestFilterHeader(t *testing.T) {
	in := http.Header{}
	for _, name := range skippedHeaders {
		in.Set(name, "x")
	}
	in.Set("Content-Type", "application/geo+json")
	in.Set("Vary", "Accept")
	in.Add("Set-Cookie", "dtCookie=v; Path=/; Domain=.weather.gov")
	out := filterHeader(in)
	for _, name := range skippedHeaders {
		if out.Get(name) != "" {
			t.Errorf("%s was forwarded", name)
		}
	}
	if out.Get("Content-Type") != "application/geo+json" || out.Get("Vary") != "Accept" {
		t.Errorf("entity headers lost: %v", out)
	}
	if in.Get("Set-Cookie") == "" {
		t.Error("filterHeader modified its input")
	}
}

func TestHeadersSentToTheClient(t *testing.T) {
	h := newHarness(t, reply(200, "x",
		"Cache-Control", "max-age=60", "Expires", "x", "Etag", `"up"`, "Last-Modified", "Mon, 19 Oct 2026 12:00:00 GMT",
		"Set-Cookie", "a=b", "Vary", "Accept", "Content-Type", "application/json"))
	for _, w := range []*httptest.ResponseRecorder{h.get("/api/x"), h.get("/api/x")} { // upstream, then cache
		got := w.Header()
		if got.Get("Expires") != "" || got.Get("Last-Modified") != "" || got.Get("Set-Cookie") != "" {
			t.Errorf("filtered headers forwarded: %v", got)
		}
		if got.Get("Etag") == `"up"` {
			t.Error("upstream ETag forwarded")
		}
		if got.Get("Vary") != "Accept" || got.Get("Cache-Control") != ClientCacheControl {
			t.Errorf("Vary %q, Cache-Control %q", got.Get("Vary"), got.Get("Cache-Control"))
		}
	}
}

func TestKey(t *testing.T) {
	tests := []struct{ target, want string }{
		{"/api/points/28.5,-81.4?x=1", "/api/points/28.5,-81.4?x=1"},
		{"/api/points/28.5%2C-81.4", "/api/points/28.5%2C-81.4"},
		{"/api/x?", "/api/x?"},
		{"/api/x?b=2&a=1", "/api/x?b=2&a=1"},
	}
	for _, tt := range tests {
		u, err := url.ParseRequestURI(tt.target)
		if err != nil {
			t.Error(err)
			continue
		}
		if got := Key(u); got != tt.want {
			t.Errorf("Key(%q) = %q, want %q", tt.target, got, tt.want)
		}
	}
}

func TestClear(t *testing.T) {
	h := newHarness(t, reply(200, "x", "Cache-Control", "max-age=60"))
	h.get("/api/x?a=1")
	if !h.cache.Clear("/api/x?a=1") {
		t.Error("Clear of a cached key = false")
	}
	if h.cache.Clear("/api/x?a=1") {
		t.Error("second Clear = true")
	}
	h.get("/api/x?a=1")
	if h.hitCount() != 2 {
		t.Errorf("upstream hits = %d, want 2 (the entry was not cleared)", h.hitCount())
	}
}

func TestSweep(t *testing.T) {
	h := newHarness(t, reply(200, "x", "Cache-Control", "max-age=60"))
	h.get("/api/old")
	h.clock.Advance(time.Hour)
	h.get("/api/new")
	h.clock.Advance(2*time.Hour + 2*time.Minute) // old is now 3h1m past its expiry, new 2h1m past
	h.cache.Sweep()
	if h.cache.Clear("/api/old") {
		t.Error("an entry more than 3h past expiry survived the sweep")
	}
	if !h.cache.Clear("/api/new") {
		t.Error("an entry less than 3h past expiry was swept")
	}
}

func TestUpstreams(t *testing.T) {
	byMount := map[string]Upstream{}
	for _, u := range Upstreams("") {
		byMount[u.Mount] = u
	}
	want := map[string]string{
		"/api/": "https://api.weather.gov", "/radar/": "https://radar.weather.gov", "/hrrr/": "https://hrrrzarr.s3.amazonaws.com",
		"/spc/": "https://www.spc.noaa.gov", "/airquality/": "https://air-quality-api.open-meteo.com",
		"/mesonet/": "https://mesonet.agron.iastate.edu", "/forecast/": "https://forecast.weather.gov",
	}
	if len(byMount) != len(want) {
		t.Fatalf("got %d upstreams, want %d", len(byMount), len(want))
	}
	for mount, base := range want {
		if byMount[mount].Base != base {
			t.Errorf("%s Base = %q, want %q", mount, byMount[mount].Base, base)
		}
	}
	for _, u := range Upstreams("x.example") {
		if u.Mount == "/mesonet/" && u.Base != "https://x.example" {
			t.Errorf("mesonet Base with override = %q", u.Base)
		}
	}
	mesonet := byMount["/mesonet/"].Binary
	for path, binary := range map[string]bool{"/a.PNG": true, "/b.jpeg": true, "/c.ico": true, "/d.json": false, "/png": false} {
		if mesonet(path) != binary {
			t.Errorf("mesonet Binary(%q) = %v, want %v", path, !binary, binary)
		}
	}
	if byMount["/api/"].Binary != nil || byMount["/radar/"].Binary == nil || byMount["/hrrr/"].Binary == nil {
		t.Error("body modes: want /api/ text, /radar/ and /hrrr/ binary")
	}
}

// tlsUpstream is an httptest TLS server the cache trusts, mounted at /api/.
func tlsUpstream(t *testing.T, configure func(*httptest.Server)) (*Cache, *http.ServeMux, chan string) {
	t.Helper()
	protos := make(chan string, 1)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		protos <- r.Proto
		if _, err := w.Write([]byte("ok")); err != nil {
			return
		}
	}))
	configure(srv)
	srv.StartTLS()
	t.Cleanup(srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	c := New(slog.New(slog.DiscardHandler), WithIdleTimeout(testIdle), WithRootCAs(pool))
	mux := http.NewServeMux()
	mux.Handle("/api/", c.Handler(Upstream{Mount: "/api/", Base: srv.URL, Service: "Weather.gov"}))
	return c, mux, protos
}

func getVia(t *testing.T, mux *http.ServeMux, target string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, target, nil))
	return w
}

// Owner ruling: upstream TLS is 1.3 or nothing, OVERRIDE_RADAR_HOST included.
func TestUpstreamTLSBelow13IsRefused(t *testing.T) {
	_, mux, _ := tlsUpstream(t, func(s *httptest.Server) {
		s.TLS = &tls.Config{MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12}
	})
	expect(t, getVia(t, mux, "/api/x"), 500, `{"error":"Failed to fetch data from Weather.gov"}`, "")
}

// Node's https.get spoke HTTP/1.1; the cache does too, even to a server offering h2.
func TestUpstreamIsHTTP11OverTLS13(t *testing.T) {
	_, mux, protos := tlsUpstream(t, func(s *httptest.Server) { s.EnableHTTP2 = true })
	expect(t, getVia(t, mux, "/api/x"), 200, "ok", ClientCacheControl)
	if got := <-protos; got != "HTTP/1.1" {
		t.Errorf("upstream saw %s, want HTTP/1.1", got)
	}
}

// A first client that never reads its (large) response must not hold up a request that
// waited on its fetch: the in-flight slot is released once the cache has the result,
// before the response is written.
func TestWaiterDoesNotDependOnTheFirstClientReading(t *testing.T) {
	big := bytes.Repeat([]byte("x"), 32<<20)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.Header().Set("Cache-Control", "max-age=60")
		if _, err := w.Write(big); err != nil {
			return
		}
	}))
	t.Cleanup(up.Close)
	c := New(slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	mux.Handle("/radar/", c.Handler(Upstream{Mount: "/radar/", Base: up.URL, Service: "Radar", Binary: always}))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	// client A sends its request and never reads the answer
	a, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	if _, err := io.WriteString(a, "GET /radar/x.png HTTP/1.1\r\nHost: x\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond) // B arrives while A's upstream fetch is in flight

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/radar/x.png", nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("waiter got no response within 5 s while the first client was stalled: %v", err)
	}
	defer res.Body.Close()
	n, err := io.Copy(io.Discard, res.Body)
	if err != nil || n != int64(len(big)) {
		t.Errorf("waiter read %d bytes (%v), want %d", n, err, len(big))
	}
}
