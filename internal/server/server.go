// Package server is the HTTP side of ws4kp: the index with its per-request injections,
// the static trees with their cache policy, the music and custom-script overlays, the data
// and geoip endpoints, the proxies and their cache management, and graceful shutdown.
package server

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/jacaudi/ws4kp/internal/config"
	"github.com/jacaudi/ws4kp/internal/express"
	"github.com/jacaudi/ws4kp/internal/playlist"
	"github.com/jacaudi/ws4kp/internal/proxy"
)

const (
	// ReadHeaderTimeout bounds a client's request headers. There is deliberately no
	// WriteTimeout: MP3 streaming and slow upstreams run long.
	ReadHeaderTimeout = 10 * time.Second
	// ReadTimeout bounds reading the whole request (the browser sends no bodies). It does
	// not cut off a long response, nor cancel the request's context.
	ReadTimeout = 60 * time.Second
	// IdleTimeout closes idle keep-alive connections.
	IdleTimeout = 120 * time.Second
	// ShutdownTimeout is the drain budget after SIGINT/SIGTERM, under Kubernetes' 30 s grace.
	ShutdownTimeout = 20 * time.Second
	// HealthcheckTimeout stays under the image HEALTHCHECK's 5 s.
	HealthcheckTimeout = 4 * time.Second

	dataCacheControl = "public, max-age=2592000, immutable"
	devtoolsUUID     = "d2bd1130-560f-4c8e-b2c5-e91073784964"
)

// dataFiles are served at /data/<name> with a 30-day immutable policy.
var dataFiles = []string{"travelcities.json", "regionalcities.json", "stations.json"}

// Assets are the trees the binary embeds (package web), each rooted at its directory.
type Assets struct {
	Dist    fs.FS // web/dist: the built site
	Scripts fs.FS // web/server/scripts: served at /scripts/
}

// Server serves ws4kp.
type Server struct {
	cfg     config.Config
	logger  *slog.Logger
	cache   *proxy.Cache
	handler http.Handler

	upstreams                               []proxy.Upstream
	site, scripts, resources, music, custom tree
	index                                   func() ([]byte, error)
	overrides                               []byte // OverridesJSON(cfg.Overrides), built once
	data                                    map[string][]byte

	playlistSources []playlist.Source
	playlistReady   chan struct{}
	playlistBody    []byte
}

// New builds the server for cfg. In production it serves assets; with cfg.Dev it serves
// cfg.WebDir from disk instead. It fails when the index or a data file is missing.
func New(cfg config.Config, assets Assets, logger *slog.Logger) (*Server, error) {
	return newServer(cfg, assets, logger, proxy.Upstreams(cfg.Overrides["RADAR_HOST"]))
}

func newServer(cfg config.Config, assets Assets, logger *slog.Logger, upstreams []proxy.Upstream) (*Server, error) {
	var err error
	s := &Server{
		cfg:           cfg,
		logger:        logger,
		cache:         proxy.New(logger),
		upstreams:     upstreams,
		music:         diskTree(cfg.MusicDir, cfg.Dev),
		custom:        diskTree(cfg.CustomDir, cfg.Dev),
		data:          map[string][]byte{},
		playlistReady: make(chan struct{}),
	}
	if s.overrides, err = OverridesJSON(cfg.Overrides); err != nil {
		return nil, err
	}
	dataFS, err := s.trees(assets)
	if err != nil {
		return nil, err
	}
	for _, name := range dataFiles {
		b, err := fs.ReadFile(dataFS, name)
		if err != nil {
			return nil, fmt.Errorf("read data file %s: %w", name, err)
		}
		s.data[name] = b
	}
	musicFS := os.DirFS(cfg.MusicDir)
	// The Node server's rule (the folder's own tracks, else its default/) applied first to
	// the music dir, then to the music/ folder built into the binary.
	s.playlistSources = []playlist.Source{
		{FS: musicFS, Dir: "."},
		{FS: musicFS, Dir: "default", Prefix: "default/"},
		{FS: assets.Dist, Dir: "music"},
		{FS: assets.Dist, Dir: "music/default", Prefix: "default/"},
	}
	s.handler = s.routes()
	return s, nil
}

// trees sets the site, scripts and index for the mode and returns the data directory.
func (s *Server) trees(assets Assets) (fs.FS, error) {
	if s.cfg.Dev {
		web := s.cfg.WebDir
		s.site = diskTree(filepath.Join(web, "server"), true)
		s.scripts = diskTree(filepath.Join(web, "server", "scripts"), true)
		s.resources = diskTree(filepath.Join(web, "server", "scripts", "modules"), true)
		devIndex := filepath.Join(web, ".dev", "index.html")
		s.index = func() ([]byte, error) { return os.ReadFile(devIndex) } //nolint:gosec // a fixed path under the configured web dir
		html, err := s.index()
		if err != nil {
			return nil, fmt.Errorf("dev index %s: %w (run `npm --prefix web run dev:index`)", devIndex, err)
		}
		if err := checkMarkers(html); err != nil {
			return nil, fmt.Errorf("dev index %s (rebuild it with `npm --prefix web run dev:index`): %w", devIndex, err)
		}
		return os.DirFS(filepath.Join(web, "datagenerators", "output")), nil
	}
	var err error
	if s.site, err = embeddedTree(assets.Dist); err != nil {
		return nil, err
	}
	if s.scripts, err = embeddedTree(assets.Scripts); err != nil {
		return nil, err
	}
	html, err := fs.ReadFile(assets.Dist, "index.html")
	if err != nil {
		return nil, fmt.Errorf("embedded build has no index.html (run `npm --prefix web run build` before building the binary): %w", err)
	}
	if err := checkMarkers(html); err != nil {
		return nil, fmt.Errorf("embedded index.html (rebuild with `npm --prefix web run build`): %w", err)
	}
	s.index = func() ([]byte, error) { return html, nil }
	data, err := fs.Sub(assets.Dist, "data")
	if err != nil {
		return nil, fmt.Errorf("embedded data dir: %w", err)
	}
	return data, nil
}

// Handler returns the root handler; every response carries X-Weatherstar: true, which the
// browser reads to tell a static deployment's 404 from a network failure.
func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.serveIndex)
	mux.HandleFunc("GET /index.html", s.serveIndex)
	for _, name := range dataFiles {
		mux.HandleFunc("GET /data/"+name, s.serveData(name))
	}
	mux.HandleFunc("GET /geoip", serveGeoip)
	mux.HandleFunc("GET /geoip/", serveGeoip)
	mux.HandleFunc("GET /scripts/", s.serveScripts)
	mux.HandleFunc("GET /music/", s.serveMusic)
	mux.HandleFunc("GET /", s.serveSite)
	if s.cfg.Dev {
		mux.HandleFunc("GET /resources/", s.serveDevResources)
		mux.HandleFunc("GET /.well-known/appspecific/com.chrome.devtools.json", s.serveDevtools)
	}
	if !s.cfg.Static {
		for _, u := range s.upstreams {
			mux.Handle("GET "+u.Mount, s.cache.Handler(u))
		}
		mux.HandleFunc("DELETE /cache/", s.clearCache)
		mux.HandleFunc("GET /playlist.json", s.servePlaylist)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Weatherstar", "true")
		mux.ServeHTTP(w, r)
	})
}

// Run serves on ln until ctx is done, then drains in-flight requests for up to
// ShutdownTimeout. It also builds the playlist and runs the cache sweeper.
func (s *Server) Run(ctx context.Context, ln net.Listener) error {
	srv := &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: ReadHeaderTimeout,
		ReadTimeout:       ReadTimeout,
		IdleTimeout:       IdleTimeout,
	}
	go s.loadPlaylist(ctx)
	go s.cache.RunSweeper(ctx)

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Serve(ln)
	}()
	select {
	case err := <-errCh:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}
	s.logger.Debug("draining", "timeout", ShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}

// serveIndex answers / and /index.html (D4). With WSQS_* variables set and an empty query
// it redirects to the query they spell (307). The Location is a query-only relative
// reference (D3): it resolves against the request's own URL, so a path prefix added by a
// reverse proxy is kept.
func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	params := express.ParseQuery(r.URL.RawQuery)
	if len(s.cfg.Query) > 0 && len(params) == 0 {
		w.Header().Set("Location", "?"+express.EncodeQuery(s.cfg.Query))
		w.WriteHeader(http.StatusTemporaryRedirect)
		return
	}
	html, err := s.index()
	if err != nil {
		s.logger.Error("read index", "error", err)
		http.Error(w, "index unavailable", http.StatusInternalServerError)
		return
	}
	body := Render(html, RenderOptions{
		Server:    !s.cfg.Static,
		Overrides: s.overrides,
		Kiosk:     isTrue(params, "kiosk") || isTrue(params, "settings-kiosk-checkbox"),
	})
	w.Header().Set("Content-Type", express.HTMLType)
	express.Send(w, r, http.StatusOK, body)
}

// isTrue is the EJS template's query[key] === 'true': exactly one value, "true".
func isTrue(params []express.Param, key string) bool {
	v := express.Lookup(params, key)
	return len(v) == 1 && v[0] == "true"
}

func (s *Server) loadPlaylist(ctx context.Context) {
	p := playlist.Load(ctx, s.logger, s.playlistSources...)
	body, err := express.Marshal(p)
	if err != nil {
		s.logger.Error("encode playlist", "error", err)
		body = []byte(`{"availableFiles":[]}`)
	}
	s.playlistBody = body
	close(s.playlistReady)
}

func (s *Server) servePlaylist(w http.ResponseWriter, r *http.Request) {
	select {
	case <-s.playlistReady:
	case <-r.Context().Done():
		return
	}
	w.Header().Set("Content-Type", express.JSONType)
	express.Send(w, r, http.StatusOK, s.playlistBody)
}

func (s *Server) serveData(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", dataCacheControl)
		w.Header().Set("Content-Type", express.JSONType)
		express.Send(w, r, http.StatusOK, s.data[name])
	}
}

// clearCache is DELETE /cache/<key>: the key is the proxied request's path and query.
func (s *Server) clearCache(w http.ResponseWriter, r *http.Request) {
	key := proxy.Key(r.URL)[len("/cache"):]
	express.JSON(w, r, http.StatusOK, struct {
		Cleared bool   `json:"cleared"`
		Path    string `json:"path"`
	}{s.cache.Clear(key), key})
}

func serveGeoip(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	for k, v := range map[string]string{
		"X-Geoip-City":                "Orlando",
		"X-Geoip-Country":             "US",
		"X-Geoip-Country-Name":        "United States",
		"X-Geoip-Country-Region":      "FL",
		"X-Geoip-Country-Region-Name": "Florida",
		"X-Geoip-Latitude":            "28.52135",
		"X-Geoip-Longitude":           "-81.41079",
		"X-Geoip-Postal-Code":         "32789",
		"X-Geoip-Time-Zone":           "America/New_York",
	} {
		h.Set(k, v)
	}
	express.JSON(w, r, http.StatusOK, struct{}{})
}

// serveDevtools answers Chrome's workspace probe for loopback clients only.
func (s *Server) serveDevtools(w http.ResponseWriter, r *http.Request) {
	if !loopback(r.RemoteAddr) {
		w.Header().Set("Content-Type", express.HTMLType)
		express.Send(w, r, http.StatusNotFound, []byte("File not found"))
		return
	}
	root, err := filepath.Abs(filepath.Join(s.cfg.WebDir, "server"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	type workspace struct {
		UUID string `json:"uuid"`
		Root string `json:"root"`
	}
	s.logger.Debug("devtools workspace", "root", root)
	express.JSON(w, r, http.StatusOK, struct {
		Workspace workspace `json:"workspace"`
	}{workspace{devtoolsUUID, root}})
}

// loopback reports whether addr (host:port) is one of the three addresses the Node server
// accepted: 127.0.0.1, ::1 and ::ffff:127.0.0.1.
func loopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.Equal(net.IPv4(127, 0, 0, 1)) || ip.Equal(net.IPv6loopback))
}

// Healthcheck GETs url and fails unless the answer is 2xx within HealthcheckTimeout; the
// image's HEALTHCHECK runs it as `ws4kp healthcheck`.
func Healthcheck(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("healthcheck request: %w", err)
	}
	res, err := (&http.Client{Timeout: HealthcheckTimeout}).Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck // read-only
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("healthcheck: %s answered %s", url, res.Status)
	}
	return nil
}
