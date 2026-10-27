package server

import (
	"bytes"
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
	"unicode/utf8"

	"github.com/jacaudi/ws4kp/internal/config"
	"github.com/jacaudi/ws4kp/internal/express"
	"github.com/jacaudi/ws4kp/internal/proxy"
)

// bundled stands in for an embedded MP3; the static tests only need its bytes.
var bundled = bytes.Repeat([]byte("0123456789"), 100)

func testAssets(t *testing.T) Assets {
	t.Helper()
	return Assets{
		Dist: fstest.MapFS{
			"index.html":                {Data: fixture(t)},
			"manifest.json":             {Data: []byte(`{"name":"WeatherStar 4000+"}`)},
			"resources/ws.min.js":       {Data: []byte("js")},
			"images/logos/logo192.png":  {Data: []byte("png")},
			"music/default/bundled.mp3": {Data: bundled},
			"data/travelcities.json":    {Data: []byte(`["travel"]`)},
			"data/regionalcities.json":  {Data: []byte(`["regional"]`)},
			"data/stations.json":        {Data: []byte(`["stations"]`)},
			"playlist.json":             {Data: []byte(`{"built":"by gulp"}`)},
			".hidden":                   {Data: []byte("secret")},
		},
		Scripts: fstest.MapFS{
			"ws.mjs":         {Data: []byte("embedded ws.mjs")},
			"modules/a.mjs":  {Data: []byte("module")},
			"custom.js":      {Data: []byte("embedded custom.js")},
			"vendor/.secret": {Data: []byte("x")},
		},
	}
}

type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

type testServer struct {
	*Server
	t    *testing.T
	cfg  config.Config
	logs *logBuffer
}

// newTestServer builds a production-mode server over testAssets, with empty music and
// custom dirs and the proxies pointing at upstream (or nowhere).
func newTestServer(t *testing.T, mutate func(*config.Config), upstreams ...proxy.Upstream) *testServer {
	t.Helper()
	cfg := config.Config{Port: 8080, WebDir: "web", MusicDir: t.TempDir(), CustomDir: t.TempDir(), Overrides: map[string]string{}}
	if mutate != nil {
		mutate(&cfg)
	}
	logs := &logBuffer{}
	s, err := newServer(cfg, testAssets(t), slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})), upstreams)
	if err != nil {
		t.Fatal(err)
	}
	s.loadPlaylist(t.Context())
	return &testServer{Server: s, t: t, cfg: cfg, logs: logs}
}

func (s *testServer) do(method, target string, header ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(s.t.Context(), method, target, nil)
	for i := 0; i+1 < len(header); i += 2 {
		r.Header.Set(header[i], header[i+1])
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func (s *testServer) get(target string, header ...string) *httptest.ResponseRecorder {
	return s.do(http.MethodGet, target, header...)
}

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	file := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestWSQSRedirect(t *testing.T) {
	s := newTestServer(t, func(c *config.Config) {
		c.Query = []express.Param{{Key: "latLonQuery", Values: []string{"Orlando, FL"}}, {Key: "kiosk", Values: []string{"true"}}}
	})
	for _, target := range []string{"/", "/?", "/?&", "/index.html"} {
		w := s.get(target)
		if w.Code != http.StatusTemporaryRedirect {
			t.Errorf("GET %s = %d, want 307", target, w.Code)
		}
		// D3: query-only and relative, so a reverse proxy's path prefix survives
		if got := w.Header().Get("Location"); got != "?latLonQuery=Orlando%2C+FL&kiosk=true" {
			t.Errorf("GET %s Location = %q", target, got)
		}
	}
	if w := s.get("/?latLonQuery=x"); w.Code != http.StatusOK {
		t.Errorf("GET with a query = %d, want 200", w.Code)
	}
}

func TestIndex(t *testing.T) {
	tests := []struct {
		name       string
		static     bool
		target     string
		wantServer bool
		wantKiosk  bool
	}{
		{"server mode", false, "/", true, false},
		{"static mode", true, "/", false, false},
		{"kiosk", false, "/?kiosk=true", true, true},
		{"settings kiosk checkbox", false, "/?settings-kiosk-checkbox=true", true, true},
		{"kiosk=false", false, "/?kiosk=false", true, false},
		{"/index.html gets the same injection (D4)", false, "/index.html?kiosk=true", true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestServer(t, func(c *config.Config) {
				c.Static = tt.static
				c.Overrides = map[string]string{"RADAR_HOST": "x.example"}
			})
			w := s.get(tt.target)
			body := w.Body.String()
			if w.Code != 200 {
				t.Fatalf("status = %d", w.Code)
			}
			if got := strings.Contains(body, serverScript); got != tt.wantServer {
				t.Errorf("server flag present = %v, want %v", got, tt.wantServer)
			}
			if got := strings.Contains(body, `<body class="kiosk">`); got != tt.wantKiosk {
				t.Errorf("kiosk class present = %v, want %v", got, tt.wantKiosk)
			}
			if !strings.Contains(body, overridesStart+`{"RADAR_HOST":"x.example"}`+overridesEnd) {
				t.Error("runtime OVERRIDES not injected")
			}
			h := w.Header()
			if h.Get("Content-Type") != express.HTMLType || h.Get("Cache-Control") != "" || !strings.HasPrefix(h.Get("Etag"), `W/"`) {
				t.Errorf("headers = %v; want text/html, no Cache-Control, a weak ETag", h)
			}
		})
	}
}

func TestStaticCachePolicyAndTypes(t *testing.T) {
	s := newTestServer(t, nil)
	tests := []struct{ target, cacheControl, contentType string }{
		{"/images/logos/logo192.png", "public, max-age=31536000, immutable", "image/png"},
		{"/resources/ws.min.js", "public, max-age=0, must-revalidate", "text/javascript; charset=utf-8"},
		{"/scripts/ws.mjs", "public, max-age=0, must-revalidate", "text/javascript; charset=utf-8"},
		{"/manifest.json", "public, max-age=3600, must-revalidate", "application/json; charset=utf-8"},
		{"/music/default/bundled.mp3", "public, max-age=3600, must-revalidate", "audio/mpeg"},
	}
	for _, tt := range tests {
		w := s.get(tt.target)
		if w.Code != 200 {
			t.Errorf("GET %s = %d", tt.target, w.Code)
			continue
		}
		if got := w.Header().Get("Cache-Control"); got != tt.cacheControl {
			t.Errorf("GET %s Cache-Control = %q, want %q", tt.target, got, tt.cacheControl)
		}
		if got := w.Header().Get("Content-Type"); got != tt.contentType {
			t.Errorf("GET %s Content-Type = %q, want %q", tt.target, got, tt.contentType)
		}
		if got := w.Header().Get("Last-Modified"); got != "" {
			t.Errorf("GET %s Last-Modified = %q, want none (D2)", tt.target, got)
		}
	}
}

func TestStrongETag(t *testing.T) {
	s := newTestServer(t, nil)
	etag := s.get("/manifest.json").Header().Get("Etag")
	if !regexp.MustCompile(`^"[0-9a-f]{32}"$`).MatchString(etag) {
		t.Fatalf("ETag = %q, want a strong 32-hex-digit validator", etag)
	}
	if w := s.get("/manifest.json", "If-None-Match", etag); w.Code != http.StatusNotModified {
		t.Errorf("revalidation = %d, want 304", w.Code)
	}
}

func TestRangeAndHead(t *testing.T) {
	s := newTestServer(t, nil)
	w := s.get("/music/default/bundled.mp3", "Range", "bytes=0-99")
	if w.Code != http.StatusPartialContent || w.Body.Len() != 100 || w.Header().Get("Content-Range") != "bytes 0-99/1000" {
		t.Errorf("range = %d, %d bytes, Content-Range %q; want 206, 100, bytes 0-99/1000", w.Code, w.Body.Len(), w.Header().Get("Content-Range"))
	}
	if w.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("Accept-Ranges = %q", w.Header().Get("Accept-Ranges"))
	}
	head := s.do(http.MethodHead, "/scripts/custom.js")
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "18" {
		t.Errorf("HEAD custom.js = %d, %d body bytes, length %q", head.Code, head.Body.Len(), head.Header().Get("Content-Length"))
	}
	if head := s.do(http.MethodHead, "/scripts/custom.mjs"); head.Code != 404 {
		t.Errorf("HEAD custom.mjs = %d, want 404", head.Code)
	}
}

func TestNotServed(t *testing.T) {
	s := newTestServer(t, nil)
	writeFile(t, s.cfg.MusicDir, ".env", "secret")
	for _, target := range []string{
		"/.hidden", "/scripts/vendor/.secret", "/music/.env", // dotfiles
		"/music/", "/music/default/", "/scripts/", "/scripts/modules/", "/images/", // no listings
		"/nope.html", "/music/..%2f..%2fetc%2fpasswd", "/scripts/..%2findex.html",
	} {
		if w := s.get(target); w.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", target, w.Code)
		}
	}
}

func TestXWeatherstarOnEveryResponse(t *testing.T) {
	s := newTestServer(t, nil)
	for _, tt := range []struct {
		method, target string
		status         int
	}{{"GET", "/manifest.json", 200}, {"GET", "/nope", 404}, {"POST", "/geoip", 405}} {
		w := s.do(tt.method, tt.target)
		if w.Code != tt.status || w.Header().Get("X-Weatherstar") != "true" {
			t.Errorf("%s %s = %d, X-Weatherstar %q; want %d, true", tt.method, tt.target, w.Code, w.Header().Get("X-Weatherstar"), tt.status)
		}
	}
}

func TestDataEndpoints(t *testing.T) {
	s := newTestServer(t, nil)
	for name, body := range map[string]string{"travelcities": `["travel"]`, "regionalcities": `["regional"]`, "stations": `["stations"]`} {
		w := s.get("/data/" + name + ".json")
		h := w.Header()
		if w.Code != 200 || w.Body.String() != body {
			t.Errorf("%s = %d %q", name, w.Code, w.Body.String())
		}
		if h.Get("Cache-Control") != dataCacheControl || h.Get("Content-Type") != express.JSONType || !strings.HasPrefix(h.Get("Etag"), `W/"`) {
			t.Errorf("%s headers = %v", name, h)
		}
		if again := s.get("/data/"+name+".json", "If-None-Match", h.Get("Etag")); again.Code != http.StatusNotModified {
			t.Errorf("%s revalidation = %d, want 304", name, again.Code)
		}
	}
}

func TestGeoip(t *testing.T) {
	s := newTestServer(t, nil)
	for _, target := range []string{"/geoip", "/geoip/anything"} {
		w := s.get(target)
		if w.Code != 200 || w.Body.String() != "{}" || w.Header().Get("X-Geoip-City") != "Orlando" || w.Header().Get("X-Geoip-Time-Zone") != "America/New_York" {
			t.Errorf("GET %s = %d %q %v", target, w.Code, w.Body.String(), w.Header())
		}
	}
}

// D7: the proxies and /geoip answer only GET and HEAD.
func TestMethodNotAllowed(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	t.Cleanup(up.Close)
	s := newTestServer(t, nil, proxy.Upstream{Mount: "/api/", Base: up.URL, Service: "test"})
	for _, target := range []string{"/api/points/1,2", "/geoip"} {
		w := s.do(http.MethodPost, target)
		if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("POST %s = %d, Allow %q; want 405, GET, HEAD", target, w.Code, w.Header().Get("Allow"))
		}
	}
}

func TestProxyRoutesAndCacheDelete(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "max-age=60")
		if _, err := w.Write([]byte(`{"ok":true}`)); err != nil {
			return
		}
	}))
	t.Cleanup(up.Close)
	s := newTestServer(t, nil, proxy.Upstream{Mount: "/api/", Base: up.URL, Service: "test"})
	if w := s.get("/api/points/1?a=1&b=2"); w.Code != 200 || w.Header().Get("X-Weatherstar") != "true" {
		t.Fatalf("proxied GET = %d %v", w.Code, w.Header())
	}
	w := s.do(http.MethodDelete, "/cache/api/points/1?a=1&b=2")
	if w.Code != 200 || w.Body.String() != `{"cleared":true,"path":"/api/points/1?a=1&b=2"}` {
		t.Errorf("DELETE = %d %s", w.Code, w.Body.String())
	}
	if w := s.do(http.MethodDelete, "/cache/api/points/1?a=1&b=2"); w.Body.String() != `{"cleared":false,"path":"/api/points/1?a=1&b=2"}` {
		t.Errorf("second DELETE = %s", w.Body.String())
	}
}

func TestStaticModeDisablesServerRoutes(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("static mode reached the upstream") }))
	t.Cleanup(up.Close)
	s := newTestServer(t, func(c *config.Config) { c.Static = true }, proxy.Upstream{Mount: "/api/", Base: up.URL, Service: "test"})
	if w := s.get("/api/points/1"); w.Code != http.StatusNotFound {
		t.Errorf("GET /api/ in static mode = %d, want 404", w.Code)
	}
	if w := s.do(http.MethodDelete, "/cache/api/points/1"); w.Code == http.StatusOK {
		t.Errorf("DELETE /cache in static mode = %d, want an error status", w.Code)
	}
	// the static build's own playlist.json, as express.static served it
	if w := s.get("/playlist.json"); w.Code != 200 || w.Body.String() != `{"built":"by gulp"}` {
		t.Errorf("GET /playlist.json in static mode = %d %q", w.Code, w.Body.String())
	}
}

func TestPlaylistFallsBackToTheEmbeddedTracks(t *testing.T) {
	s := newTestServer(t, nil)
	w := s.get("/playlist.json")
	// bundled.mp3 is not real audio, so it is listed without metadata
	if w.Code != 200 || w.Body.String() != `{"availableFiles":["default/bundled.mp3"],"metaData":{}}` || w.Header().Get("Content-Type") != express.JSONType {
		t.Errorf("GET /playlist.json = %d %s %v", w.Code, w.Body.String(), w.Header())
	}
}

// Tracks that were in web/server/music when the binary was built are its playlist, ahead
// of the bundled default/ set, as they were the Node image's; a mount still wins.
func TestEmbeddedOwnTracksBeatTheBundledSet(t *testing.T) {
	cfg := config.Config{MusicDir: t.TempDir(), CustomDir: t.TempDir()}
	assets := testAssets(t)
	assets.Dist.(fstest.MapFS)["music/own.mp3"] = &fstest.MapFile{Data: []byte("built in")}
	s, err := newServer(cfg, assets, slog.New(slog.DiscardHandler), nil)
	if err != nil {
		t.Fatal(err)
	}
	s.loadPlaylist(t.Context())
	ts := &testServer{Server: s, t: t, cfg: cfg, logs: &logBuffer{}}
	if w := ts.get("/playlist.json"); w.Body.String() != `{"availableFiles":["own.mp3"],"metaData":{}}` {
		t.Errorf("playlist = %s", w.Body.String())
	}
	if w := ts.get("/music/own.mp3"); w.Code != 200 || w.Body.String() != "built in" {
		t.Errorf("GET /music/own.mp3 = %d %q", w.Code, w.Body.String())
	}
	writeFile(t, cfg.MusicDir, "mounted.mp3", "mounted")
	s2, err := newServer(cfg, assets, slog.New(slog.DiscardHandler), nil)
	if err != nil {
		t.Fatal(err)
	}
	s2.loadPlaylist(t.Context())
	ts2 := &testServer{Server: s2, t: t, cfg: cfg, logs: &logBuffer{}}
	if w := ts2.get("/playlist.json"); w.Body.String() != `{"availableFiles":["mounted.mp3"],"metaData":{}}` {
		t.Errorf("playlist with a mount = %s", w.Body.String())
	}
}

func TestCustomOverlay(t *testing.T) {
	s := newTestServer(t, nil)
	writeFile(t, s.cfg.CustomDir, "custom.mjs", "mounted custom.mjs")
	writeFile(t, s.cfg.CustomDir, "ws.mjs", "must not shadow the app")
	tests := []struct{ target, want string }{
		{"/scripts/custom.mjs", "mounted custom.mjs"},
		{"/scripts/custom.js", "embedded custom.js"},
		{"/scripts/ws.mjs", "embedded ws.mjs"},
		{"/scripts/modules/a.mjs", "module"},
	}
	for _, tt := range tests {
		if w := s.get(tt.target); w.Code != 200 || w.Body.String() != tt.want {
			t.Errorf("GET %s = %d %q, want %q", tt.target, w.Code, w.Body.String(), tt.want)
		}
	}
	writeFile(t, s.cfg.CustomDir, "custom.js", "mounted custom.js")
	w := s.get("/scripts/custom.js")
	if w.Body.String() != "mounted custom.js" || w.Header().Get("Last-Modified") == "" {
		t.Errorf("mounted custom.js = %q, Last-Modified %q", w.Body.String(), w.Header().Get("Last-Modified"))
	}
}

func TestMusicOverlay(t *testing.T) {
	s := newTestServer(t, nil)
	writeFile(t, s.cfg.MusicDir, "Rainy Day – Ö.mp3", "mine")
	writeFile(t, s.cfg.MusicDir, "default/bundled.mp3", "replaced")
	outside := writeFile(t, t.TempDir(), "linked-target.mp3", "linked")
	if err := os.Symlink(outside, filepath.Join(s.cfg.MusicDir, "linked.mp3")); err != nil {
		t.Fatal(err)
	}
	tests := []struct{ target, want string }{
		{"/music/Rainy%20Day%20%E2%80%93%20%C3%96.mp3", "mine"}, // the browser's encoding of the name
		{"/music/default/bundled.mp3", "replaced"},
		{"/music/linked.mp3", "linked"}, // symlinks in a mounted folder are followed, as Express did
	}
	for _, tt := range tests {
		if w := s.get(tt.target); w.Code != 200 || w.Body.String() != tt.want {
			t.Errorf("GET %s = %d %q, want %q", tt.target, w.Code, w.Body.String(), tt.want)
		}
	}
	if w := s.get("/music/missing.mp3"); w.Code != 404 {
		t.Errorf("GET a missing track = %d, want 404", w.Code)
	}
}

func TestMusicOverlayFallsBackFromAnUnreadableFile(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	s := newTestServer(t, nil)
	file := writeFile(t, s.cfg.MusicDir, "default/bundled.mp3", "unreadable")
	if err := os.Chmod(file, 0); err != nil {
		t.Fatal(err)
	}
	w := s.get("/music/default/bundled.mp3")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), bundled) {
		t.Errorf("GET = %d, %d bytes; want 200 and the embedded track", w.Code, w.Body.Len())
	}
	if !strings.Contains(s.logs.String(), "mounted files must be world-readable") {
		t.Errorf("no permission warning logged:\n%s", s.logs)
	}
}

// devWeb lays out the parts of web/ that dev mode reads.
func devWeb(t *testing.T) string {
	t.Helper()
	web := t.TempDir()
	writeFile(t, web, ".dev/index.html", "<html><body >"+serverStart+serverEnd+"<script>const OVERRIDES = "+overridesStart+"{}"+overridesEnd+";</script></body></html>")
	writeFile(t, web, "server/styles/ws.min.css", "css")
	writeFile(t, web, "server/scripts/modules/a.mjs", "module")
	writeFile(t, web, "server/music/default/disk.mp3", "disk track")
	writeFile(t, web, ".env", "SECRET=1")
	for _, name := range dataFiles {
		writeFile(t, web, "datagenerators/output/"+name, "[]")
	}
	return web
}

func newDevServer(t *testing.T) *testServer {
	t.Helper()
	web := devWeb(t)
	return newTestServer(t, func(c *config.Config) {
		c.Dev, c.WebDir = true, web
		c.MusicDir, c.CustomDir = filepath.Join(web, "server", "music"), filepath.Join(web, "server", "scripts")
	})
}

func TestDevMode(t *testing.T) {
	s := newDevServer(t)
	tests := []struct {
		target string
		status int
		body   string
	}{
		{"/styles/ws.min.css", 200, "css"},
		{"/resources/a.mjs", 200, "module"},
		{"/scripts/modules/a.mjs", 200, "module"},
		{"/music/default/disk.mp3", 200, "disk track"},
		{"/.env", 404, ""}, // web/ itself is never served
		{"/datagenerators/output/stations.json", 404, ""},
		{"/data/stations.json", 200, "[]"},
	}
	for _, tt := range tests {
		w := s.get(tt.target)
		if w.Code != tt.status || (tt.body != "" && w.Body.String() != tt.body) {
			t.Errorf("GET %s = %d %q, want %d %q", tt.target, w.Code, w.Body.String(), tt.status, tt.body)
		}
		if w.Code == 200 && !strings.HasPrefix(tt.target, "/data/") && w.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("GET %s Cache-Control = %q, want no-cache", tt.target, w.Header().Get("Cache-Control"))
		}
	}
	w := s.get("/index.html?kiosk=true")
	if !strings.Contains(w.Body.String(), `<body class="kiosk" >`+serverStart+serverScript) {
		t.Errorf("dev index = %s", w.Body.String())
	}
	if w := s.get("/playlist.json"); !strings.Contains(w.Body.String(), `"default/disk.mp3"`) {
		t.Errorf("dev playlist = %s, want the disk default/ track", w.Body.String())
	}
}

func TestDevIndexIsReadOnEveryRequest(t *testing.T) {
	s := newDevServer(t)
	writeFile(t, s.cfg.WebDir, ".dev/index.html", "<html><body>edited</body></html>")
	if w := s.get("/"); !strings.Contains(w.Body.String(), "edited") {
		t.Errorf("dev index not re-read: %s", w.Body.String())
	}
}

func TestDevtools(t *testing.T) {
	s := newDevServer(t)
	root, err := filepath.Abs(filepath.Join(s.cfg.WebDir, "server"))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"workspace":{"uuid":"` + devtoolsUUID + `","root":"` + root + `"}}`
	for _, tt := range []struct {
		remote string
		status int
		body   string
	}{
		{"127.0.0.1:5000", 200, want},
		{"[::1]:5000", 200, want},
		{"[::ffff:127.0.0.1]:5000", 200, want},
		{"127.0.0.2:5000", 404, "File not found"},
		{"192.0.2.1:5000", 404, "File not found"},
	} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/.well-known/appspecific/com.chrome.devtools.json", nil)
		r.RemoteAddr = tt.remote
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != tt.status || w.Body.String() != tt.body {
			t.Errorf("from %s = %d %q, want %d %q", tt.remote, w.Code, w.Body.String(), tt.status, tt.body)
		}
	}
	if w := newTestServer(t, nil).get("/.well-known/appspecific/com.chrome.devtools.json"); w.Code != 404 {
		t.Errorf("devtools in production = %d, want 404", w.Code)
	}
}

func TestNewFailsWithoutItsInputs(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	assets := testAssets(t)
	delete(assets.Dist.(fstest.MapFS), "index.html")
	if _, err := New(config.Config{MusicDir: t.TempDir(), CustomDir: t.TempDir()}, assets, logger); err == nil || !strings.Contains(err.Error(), "npm --prefix web run build") {
		t.Errorf("New without index.html: err = %v", err)
	}
	web := devWeb(t)
	if err := os.Remove(filepath.Join(web, ".dev", "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, err := New(config.Config{Dev: true, WebDir: web}, testAssets(t), logger); err == nil || !strings.Contains(err.Error(), "dev:index") {
		t.Errorf("New in dev without .dev/index.html: err = %v", err)
	}
}

// A built index that lost a marker, or gained one, refuses to start rather than quietly
// turning off the proxies or the runtime OVERRIDES.
func TestNewChecksTheIndexMarkers(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	cfg := config.Config{MusicDir: t.TempDir(), CustomDir: t.TempDir()}
	html := string(fixture(t))
	for name, broken := range map[string]string{
		"no server span":      strings.Replace(html, serverStart+serverEnd, "", 1),
		"two overrides spans": strings.Replace(html, "</head>", "<script>"+overridesStart+"{}"+overridesEnd+"</script></head>", 1),
	} {
		assets := testAssets(t)
		assets.Dist.(fstest.MapFS)["index.html"] = &fstest.MapFile{Data: []byte(broken)}
		if _, err := New(cfg, assets, logger); err == nil || !strings.Contains(err.Error(), "appears") {
			t.Errorf("%s: err = %v, want a marker error", name, err)
		}
	}
	web := devWeb(t)
	writeFile(t, web, ".dev/index.html", "<html><body></body></html>")
	if _, err := New(config.Config{Dev: true, WebDir: web}, testAssets(t), logger); err == nil || !strings.Contains(err.Error(), "appears") {
		t.Errorf("dev index without markers: err = %v", err)
	}
}

// An OVERRIDE_ value that is not UTF-8 reaches the page as U+FFFD, as it did from Node.
func TestIndexOverridesWithInvalidUTF8(t *testing.T) {
	s := newTestServer(t, func(c *config.Config) { c.Overrides = map[string]string{"TITLE": "Caf\xe9"} })
	want := overridesStart + `{"TITLE":"Caf` + string(utf8.RuneError) + `"}` + overridesEnd
	if body := s.get("/").Body.String(); !strings.Contains(body, want) {
		t.Errorf("index lacks %q", want)
	}
}

func TestHealthcheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	t.Cleanup(ok.Close)
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	t.Cleanup(bad.Close)
	if err := Healthcheck(t.Context(), ok.URL); err != nil {
		t.Errorf("healthy: %v", err)
	}
	if err := Healthcheck(t.Context(), bad.URL); err == nil {
		t.Error("500 passed the healthcheck")
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	if err := Healthcheck(t.Context(), closed.URL); err == nil {
		t.Error("an unreachable server passed the healthcheck")
	}
}

// Run serves until its context ends, and lets a request already in flight finish.
func TestRunDrainsInFlightRequests(t *testing.T) {
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond)
		if _, err := w.Write([]byte("slow")); err != nil {
			return
		}
	}))
	t.Cleanup(up.Close)
	cfg := config.Config{MusicDir: t.TempDir(), CustomDir: t.TempDir()}
	s, err := newServer(cfg, testAssets(t), slog.New(slog.DiscardHandler), []proxy.Upstream{{Mount: "/api/", Base: up.URL, Service: "test"}})
	if err != nil {
		t.Fatal(err)
	}
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx, ln) }()

	base := "http://" + ln.Addr().String()
	if err := Healthcheck(t.Context(), base+"/manifest.json"); err != nil {
		t.Fatal(err)
	}
	type result struct {
		body string
		err  error
	}
	got := make(chan result, 1)
	go func() {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/api/slow", nil)
		if err != nil {
			got <- result{err: err}
			return
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			got <- result{err: err}
			return
		}
		defer func() {
			if err := res.Body.Close(); err != nil {
				t.Error(err)
			}
		}()
		var b bytes.Buffer
		_, err = b.ReadFrom(res.Body)
		got <- result{b.String(), err}
	}()
	<-started
	cancel()
	if r := <-got; r.err != nil || r.body != "slow" {
		t.Errorf("in-flight request = %q, %v; want it to finish during shutdown", r.body, r.err)
	}
	if err := <-done; err != nil {
		t.Errorf("Run = %v, want nil after a clean shutdown", err)
	}
}

// The mux matches the unescaped path, so DELETE /%63ache/... reaches the handler; its key
// is the escaped path, which does not start with "/cache", and must not be sliced as if it did.
func TestCacheDeleteWithAnEscapedPrefixIs404(t *testing.T) {
	s := newTestServer(t, nil)
	w := s.do(http.MethodDelete, "/%63ache/api/x")
	if w.Code != http.StatusNotFound {
		t.Errorf("DELETE /%%63ache/api/x = %d %s, want 404", w.Code, w.Body.String())
	}
}

// net/http reports a handler panic through http.Server.ErrorLog; that goes through the
// server's slog logger, not the standard library's unstructured stderr logger.
func TestHTTPServerErrorsGoThroughTheLogger(t *testing.T) {
	logs := &logBuffer{}
	cfg := config.Config{MusicDir: t.TempDir(), CustomDir: t.TempDir()}
	s, err := newServer(cfg, testAssets(t), slog.New(slog.NewTextHandler(logs, nil)), nil)
	if err != nil {
		t.Fatal(err)
	}
	s.handler = http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx, ln) }()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+ln.Addr().String()+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp, err := http.DefaultClient.Do(req); err == nil { // the server drops the connection
		if err := resp.Body.Close(); err != nil {
			t.Error(err)
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := logs.String(); !strings.Contains(got, "level=WARN msg=\"http: panic serving") {
		t.Errorf("the panic was not logged as a WARN through slog:\n%s", got)
	}
}
