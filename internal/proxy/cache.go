// Package proxy is the caching reverse proxy in front of the weather services the browser
// app reads. It ports the Node server's cache (web/proxy/cache.mjs at 5db6464): freshness
// from s-maxage, max-age or a Last-Modified heuristic, conditional revalidation of expired
// entries, a stale copy served when the upstream fails, and waiters on an in-flight
// request that re-request rather than share a result.
package proxy

import (
	"cmp"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jacaudi/ws4kp/internal/express"
)

const (
	// UserAgent is sent upstream; api.weather.gov asks for a contact in it.
	UserAgent = "(WeatherStar 4000+, ws4000@netbymatt.com)"
	// DefaultIdleTimeout bounds each stall of an upstream exchange (connect, TLS, waiting
	// for headers, and every gap between body reads); a slow body that keeps arriving is
	// never cut off.
	DefaultIdleTimeout = 15 * time.Second
	// ClientCacheControl is the policy every proxied response carries, so browsers come
	// back to this cache instead of keeping upstream's lifetime.
	ClientCacheControl = "public, max-age=30"
	// SweepInterval is how often RunSweeper removes long-expired entries.
	SweepInterval = 5 * time.Minute
	// StaleRetention is how long past its expiry an entry is kept as a stale fallback.
	StaleRetention = 3 * time.Hour

	minHeuristic = time.Hour
	maxHeuristic = 4 * time.Hour
	maxFreshness = math.MaxInt32 // seconds; keeps the time.Duration multiplication in range
)

// skippedHeaders are not stored or sent: cache headers (this proxy sets its own policy),
// hop-by-hop headers, Content-Length (the body is re-sent with its own) and Set-Cookie (an
// upstream cookie belongs to the upstream's origin, and a cached one would go to everyone).
var skippedHeaders = []string{
	"Cache-Control", "Expires", "Etag", "Last-Modified",
	"Connection", "Keep-Alive", "Transfer-Encoding", "Te", "Trailer", "Upgrade", "Proxy-Authenticate", "Proxy-Authorization",
	"Content-Length",
	"Set-Cookie",
}

var (
	sMaxAgeRE = regexp.MustCompile(`(?i)s-maxage=(\d+)`)
	maxAgeRE  = regexp.MustCompile(`(?i)max-age=(\d+)`)
)

var errIdleTimeout = errors.New("upstream idle timeout")

type entry struct {
	status int
	header http.Header // already filtered
	body   []byte
	url    string
	// etag and lastModified are upstream's validators, sent when revalidating.
	etag, lastModified string

	// expiry and stored change on a 304 refresh; guarded by Cache.mu.
	expiry, stored time.Time
}

// Cache is the shared proxy cache. Its store is unbounded, as the Node server's was;
// RunSweeper drops entries StaleRetention past their expiry.
type Cache struct {
	logger *slog.Logger
	client *http.Client
	idle   time.Duration
	now    func() time.Time
	// rootCAs replaces the system roots when set; tests trust their own TLS servers.
	rootCAs *x509.CertPool

	mu       sync.Mutex
	entries  map[string]*entry
	inflight map[string]chan struct{}
}

// Option configures a Cache.
type Option func(*Cache)

// WithIdleTimeout replaces DefaultIdleTimeout.
func WithIdleTimeout(d time.Duration) Option { return func(c *Cache) { c.idle = d } }

// WithClock replaces time.Now, for tests.
func WithClock(now func() time.Time) Option { return func(c *Cache) { c.now = now } }

// WithRootCAs trusts pool instead of the system roots, for tests against httptest TLS servers.
func WithRootCAs(pool *x509.CertPool) Option { return func(c *Cache) { c.rootCAs = pool } }

// New returns an empty cache.
func New(logger *slog.Logger, opts ...Option) *Cache {
	c := &Cache{
		logger:   logger,
		idle:     DefaultIdleTimeout,
		now:      time.Now,
		entries:  map[string]*entry{},
		inflight: map[string]chan struct{}{},
	}
	for _, opt := range opts {
		opt(c)
	}
	c.client = &http.Client{
		Transport: &http.Transport{
			// Node's https.get used no proxy from the environment, and spoke HTTP/1.1.
			// An empty TLSNextProto map keeps this transport from negotiating h2.
			Proxy:        nil,
			TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS13, // owner ruling: every upstream, OVERRIDE_RADAR_HOST included
				RootCAs:    c.rootCAs,
			},
			DialContext:           (&net.Dialer{Timeout: c.idle, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   c.idle,
			ResponseHeaderTimeout: c.idle,
			IdleConnTimeout:       90 * time.Second,
			MaxIdleConns:          100,
			MaxIdleConnsPerHost:   10,
			// Node's https.get sent no Accept-Encoding; asking for gzip would change what
			// upstream sends and what Vary means for the stored copy.
			DisableCompression: true,
		},
		// A redirect is a response like any other: passed through with its Location.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return c
}

// Key is the cache key for a request URL: the escaped path, plus the raw query when the
// URL has one. DELETE /cache/<key> addresses entries by the same form.
func Key(u *url.URL) string {
	if u.RawQuery != "" || u.ForceQuery {
		return u.EscapedPath() + "?" + u.RawQuery
	}
	return u.EscapedPath()
}

// Clear removes the entry for key and reports whether there was one.
func (c *Cache) Clear(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.entries[key]
	delete(c.entries, key)
	if ok {
		c.logger.Debug("proxy clear", "key", key)
	}
	return ok
}

// Sweep removes every entry more than StaleRetention past its expiry.
func (c *Cache) Sweep() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	before := len(c.entries)
	for key, e := range c.entries {
		if now.After(e.expiry.Add(StaleRetention)) {
			delete(c.entries, key)
		}
	}
	if removed := before - len(c.entries); removed > 0 {
		c.logger.Debug("proxy sweep", "removed", removed, "remaining", len(c.entries))
	}
}

// RunSweeper calls Sweep every SweepInterval until ctx is done.
func (c *Cache) RunSweeper(ctx context.Context) {
	ticker := time.NewTicker(SweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.Sweep()
		}
	}
}

// request is one proxied request, resolved against its upstream.
type request struct {
	key, target, service string
	binary               bool
	// release frees the in-flight slot. It runs once the cache holds this request's
	// outcome and before the response is written, so waiters never depend on how fast
	// this client reads.
	release func()
}

// Handler serves u through the cache. It expects GET or HEAD; the upstream request is
// always a GET.
func (c *Cache) Handler(u Upstream) http.Handler {
	mount := strings.TrimSuffix(u.Mount, "/")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.EscapedPath(), mount)
		req := request{
			key:     Key(r.URL),
			target:  u.Base + rel,
			service: u.Service,
			binary:  u.Binary != nil && u.Binary(rel),
		}
		if q := forwardQuery(r.URL.RawQuery, u.SkipParams); q != "" {
			req.target += "?" + q
		}
		c.serve(w, r, req)
	})
}

// forwardQuery re-encodes the query as the Node server did (Express's simple parser, then
// URLSearchParams), without the skipped parameters.
func forwardQuery(raw string, skip []string) string {
	params := express.ParseQuery(raw)
	params = slices.DeleteFunc(params, func(p express.Param) bool { return slices.Contains(skip, p.Key) })
	return express.EncodeQuery(params)
}

func (c *Cache) serve(w http.ResponseWriter, r *http.Request, req request) {
	fresh, stale := c.lookup(req.key)
	if fresh != nil {
		c.logger.Debug("proxy hit", "url", fresh.url)
		c.send(w, r, fresh, req.binary)
		return
	}
	release, wait := c.claim(req.key)
	if wait != nil {
		c.logger.Debug("proxy wait", "url", req.target)
		select {
		case <-wait:
		case <-r.Context().Done():
			return
		}
		if fresh, _ := c.lookup(req.key); fresh != nil {
			c.logger.Debug("proxy continue", "url", fresh.url)
			c.send(w, r, fresh, req.binary)
			return
		}
		c.logger.Debug("proxy redo: nothing fresh after waiting", "url", req.target)
		release, _ = c.claim(req.key)
	}
	req.release = sync.OnceFunc(release)
	defer req.release()
	c.fetch(w, r, req, stale)
}

// lookup returns the entry for key as fresh, or as stale once it has expired.
func (c *Cache) lookup(key string) (fresh, stale *entry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.entries[key]
	if e == nil {
		return nil, nil
	}
	if c.now().After(e.expiry) {
		return nil, e
	}
	return e, nil
}

// claim registers this request as the one in flight for key. If another is already in
// flight it returns that request's done channel instead (and a no-op release).
func (c *Cache) claim(key string) (release func(), wait <-chan struct{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ch, busy := c.inflight[key]; busy {
		return func() {}, ch
	}
	ch := make(chan struct{})
	c.inflight[key] = ch
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		delete(c.inflight, key)
		close(ch)
	}, nil
}

// fetch makes the upstream request and answers per the Node server's response table.
func (c *Cache) fetch(w http.ResponseWriter, r *http.Request, req request, stale *entry) {
	// The fetch outlives a client that hangs up, so the result still reaches the cache
	// and anyone waiting on it; the idle timeouts bound it instead.
	ctx, cancel := context.WithCancelCause(context.WithoutCancel(r.Context()))
	defer cancel(nil)
	up, err := http.NewRequestWithContext(ctx, http.MethodGet, req.target, nil)
	if err != nil {
		c.fail(w, r, req, stale, err)
		return
	}
	up.Header.Set("User-Agent", UserAgent)
	up.Header.Set("Accept", cmp.Or(r.Header.Get("Accept"), "*/*"))
	if stale != nil {
		if stale.etag != "" {
			up.Header.Set("If-None-Match", stale.etag)
		} else if stale.lastModified != "" {
			up.Header.Set("If-Modified-Since", stale.lastModified)
		}
	}
	res, err := c.client.Do(up)
	if err != nil {
		c.fail(w, r, req, stale, err)
		return
	}
	defer res.Body.Close() //nolint:errcheck // read-only
	if res.StatusCode == http.StatusNotModified {
		c.revalidated(w, r, req, stale, res.Header)
		return
	}
	timer := time.AfterFunc(c.idle, func() { cancel(errIdleTimeout) })
	body, err := io.ReadAll(&idleReader{r: res.Body, timer: timer, idle: c.idle})
	timer.Stop()
	if err != nil {
		if errors.Is(context.Cause(ctx), errIdleTimeout) {
			c.fail(w, r, req, stale, errIdleTimeout)
			return
		}
		c.logger.Error("proxy stream error", "url", req.target, "error", err)
		req.release()
		express.JSON(w, r, http.StatusInternalServerError, map[string]string{"error": "Stream error: " + err.Error()})
		return
	}
	c.respond(w, r, req, stale, res, body)
}

// respond handles a complete upstream response.
func (c *Cache) respond(w http.ResponseWriter, r *http.Request, req request, stale *entry, res *http.Response, body []byte) {
	status := res.StatusCode
	if status >= 400 && status <= 599 {
		c.logger.Warn("proxy upstream error", "url", req.target, "status", status)
	}
	if status >= 500 && status <= 599 {
		req.release() // a 5xx is never stored
		if c.serveStale(w, r, req, stale, fmt.Sprintf("upstream %d", status)) {
			return
		}
	}
	e := &entry{
		status:       status,
		header:       filterHeader(res.Header),
		body:         body,
		url:          req.target,
		etag:         res.Header.Get("Etag"),
		lastModified: res.Header.Get("Last-Modified"),
	}
	if status < 400 || status > 599 {
		c.store(req.key, e, res.Header)
	}
	req.release()
	c.send(w, r, e, req.binary)
}

// revalidated handles a 304: the stale entry is still good. Its lifetime is extended only
// when the 304 itself carries a max-age.
func (c *Cache) revalidated(w http.ResponseWriter, r *http.Request, req request, stale *entry, header http.Header) {
	if stale == nil {
		c.logger.Error("proxy got 304 with no stale entry", "url", req.target)
		req.release()
		express.JSON(w, r, http.StatusInternalServerError, map[string]string{"error": "Cache inconsistency error"})
		return
	}
	if seconds := maxAge(strings.Join(header.Values("Cache-Control"), ", ")); seconds > 0 {
		c.mu.Lock()
		stale.stored = c.now()
		stale.expiry = stale.stored.Add(time.Duration(seconds) * time.Second)
		c.mu.Unlock()
		c.logger.Debug("proxy not modified: expiry refreshed", "url", req.target, "seconds", seconds)
	} else {
		c.logger.Debug("proxy not modified: no max-age, expiry unchanged", "url", req.target)
	}
	req.release()
	c.send(w, r, stale, req.binary)
}

// fail answers an upstream that could not be reached or timed out: the stale copy if
// there is one, else 504 for a timeout and 500 for anything else.
func (c *Cache) fail(w http.ResponseWriter, r *http.Request, req request, stale *entry, err error) {
	timeout := isTimeout(err)
	if timeout {
		c.logger.Warn("proxy timeout", "url", req.target, "idle", c.idle)
	} else {
		c.logger.Error("proxy request failed", "url", req.target, "error", err)
	}
	req.release()
	if c.serveStale(w, r, req, stale, err.Error()) {
		return
	}
	if timeout {
		express.JSON(w, r, http.StatusGatewayTimeout, map[string]string{"error": "Gateway timeout"})
		return
	}
	express.JSON(w, r, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch data from " + req.service})
}

func (c *Cache) serveStale(w http.ResponseWriter, r *http.Request, req request, stale *entry, reason string) bool {
	if stale == nil {
		return false
	}
	c.mu.Lock()
	age := c.now().Sub(stale.stored)
	c.mu.Unlock()
	c.logger.Warn("proxy serving stale copy", "url", req.target, "reason", reason, "age", age.Round(time.Second))
	c.send(w, r, stale, req.binary)
	return true
}

// store caches e when the upstream headers give it a lifetime.
func (c *Cache) store(key string, e *entry, upstream http.Header) {
	now := c.now()
	ttl := freshness(upstream, now)
	if ttl <= 0 {
		c.logger.Debug("proxy sent: no cache directives, not cached", "url", e.url)
		return
	}
	expiry := now.Add(ttl)
	e.stored, e.expiry = now, expiry
	c.mu.Lock()
	c.entries[key] = e
	c.mu.Unlock()
	// the local, not e.expiry: once e is in the map another goroutine may rewrite it
	c.logger.Debug("proxy add", "url", e.url, "ttl", ttl, "expires", expiry)
}

// send writes an entry as Express's res.send did: filtered headers, this proxy's
// Cache-Control, the body mode's Content-Type rule, and a weak ETag.
func (c *Cache) send(w http.ResponseWriter, r *http.Request, e *entry, binary bool) {
	h := w.Header()
	for key, values := range e.header {
		h[key] = slices.Clone(values)
	}
	h.Set("Cache-Control", ClientCacheControl)
	contentType := h.Get("Content-Type")
	switch {
	case binary && contentType == "":
		h.Set("Content-Type", "application/octet-stream")
	case !binary && contentType == "":
		h.Set("Content-Type", express.HTMLType)
	case !binary:
		h.Set("Content-Type", express.WithCharset(contentType))
	}
	express.Send(w, r, e.status, e.body)
}

// filterHeader returns a copy of h without skippedHeaders.
func filterHeader(h http.Header) http.Header {
	out := h.Clone()
	for _, name := range skippedHeaders {
		out.Del(name)
	}
	return out
}

// freshness is how long a response may be served from the cache: s-maxage, else max-age,
// else 10% of the time since Last-Modified clamped to 1-4 hours. Zero means do not cache.
// An unparseable Last-Modified gives zero.
func freshness(h http.Header, now time.Time) time.Duration {
	if seconds := maxAge(strings.Join(h.Values("Cache-Control"), ", ")); seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	lastModified := h.Get("Last-Modified")
	if lastModified == "" {
		return 0
	}
	modified, err := http.ParseTime(lastModified)
	if err != nil {
		return 0
	}
	age := now.Sub(modified)
	if age <= 0 {
		return 0
	}
	heuristic := time.Duration(math.Floor(age.Seconds()*0.1)) * time.Second
	return min(max(heuristic, minHeuristic), maxHeuristic)
}

// maxAge reads s-maxage if present (even when it is 0), else max-age, matched anywhere in
// the header and case-insensitively, as the Node cache's regular expressions did.
func maxAge(cacheControl string) int64 {
	m := sMaxAgeRE.FindStringSubmatch(cacheControl)
	if m == nil {
		m = maxAgeRE.FindStringSubmatch(cacheControl)
	}
	if m == nil {
		return 0
	}
	seconds, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil { // \d+ leaves only ErrRange: a lifetime too long to represent
		return maxFreshness
	}
	return min(seconds, maxFreshness)
}

func isTimeout(err error) bool {
	if errors.Is(err, errIdleTimeout) {
		return true
	}
	netErr, ok := errors.AsType[net.Error](err)
	return ok && netErr.Timeout()
}

// idleReader resets timer after every read that made progress.
type idleReader struct {
	r     io.Reader
	timer *time.Timer
	idle  time.Duration
}

func (ir *idleReader) Read(p []byte) (int, error) {
	n, err := ir.r.Read(p)
	if n > 0 {
		ir.timer.Reset(ir.idle)
	}
	return n, err
}
