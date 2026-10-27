package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
)

// Cache-Control policy for static files, by extension (the Node server's staticOptions).
const (
	immutablePolicy  = "public, max-age=31536000, immutable"
	revalidatePolicy = "public, max-age=0, must-revalidate"
	hourPolicy       = "public, max-age=3600, must-revalidate"
	devPolicy        = "no-cache"
)

// contentTypes are the types Express's static middleware (send, via mime-types) sent for
// the extensions in the tree, so responses do not depend on the host's mime.types.
var contentTypes = map[string]string{
	".css":   "text/css; charset=utf-8",
	".eot":   "application/vnd.ms-fontobject",
	".gif":   "image/gif",
	".html":  "text/html; charset=utf-8",
	".ico":   "image/vnd.microsoft.icon",
	".jpeg":  "image/jpeg",
	".jpg":   "image/jpeg",
	".js":    "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".map":   "application/json; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".mp3":   "audio/mpeg",
	".png":   "image/png",
	".scss":  "text/x-scss; charset=utf-8",
	".svg":   "image/svg+xml",
	".ttf":   "font/ttf",
	".txt":   "text/plain; charset=utf-8",
	".webp":  "image/webp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

// tree is a directory of static files.
type tree struct {
	fsys fs.FS
	// etags are strong validators for an embedded tree, computed once; nil for a tree on
	// disk, whose files ServeContent validates by modification time instead.
	etags map[string]string
	dev   bool // Cache-Control: no-cache on everything
}

func diskTree(dir string, dev bool) tree { return tree{fsys: os.DirFS(dir), dev: dev} }

// embeddedTree hashes every file of fsys: embedded files have no modification time, so
// without an ETag a browser could never revalidate them.
func embeddedTree(fsys fs.FS) (tree, error) {
	etags := map[string]string{}
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return err
		}
		f, err := fsys.Open(name)
		if err != nil {
			return err
		}
		defer f.Close() //nolint:errcheck // read-only
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		etags[name] = `"` + hex.EncodeToString(h.Sum(nil)[:16]) + `"`
		return nil
	})
	if err != nil {
		return tree{}, fmt.Errorf("hash embedded files: %w", err)
	}
	return tree{fsys: fsys, etags: etags}, nil
}

// serve writes the file name from t and reports whether t has it as a regular file.
// Range, HEAD and conditional requests come from http.ServeContent.
func (t tree) serve(w http.ResponseWriter, r *http.Request, name string, logger *slog.Logger) bool {
	f, err := t.fsys.Open(name)
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			// The image runs as uid 65532: a mounted file that is not world-readable fails here.
			logger.Warn("cannot read file; mounted files must be world-readable", "file", name, "error", err)
		}
		return false
	}
	defer f.Close() //nolint:errcheck // read-only
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	h := w.Header()
	h.Set("Cache-Control", t.cacheControl(name))
	h.Set("Content-Type", contentType(name))
	if etag, ok := t.etags[name]; ok {
		h.Set("Etag", etag)
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
	return true
}

func (t tree) cacheControl(name string) string {
	if t.dev {
		return devPolicy
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot":
		return immutablePolicy
	case ".css", ".js", ".mjs":
		return revalidatePolicy
	default:
		return hourPolicy
	}
}

func contentType(name string) string {
	if t, ok := contentTypes[strings.ToLower(path.Ext(name))]; ok {
		return t
	}
	return "application/octet-stream"
}

// fsName turns the URL path below prefix into a file name, or "" when nothing may be
// served for it: a directory (no listings, ever), a dotfile at any depth, or a name
// fs.ValidPath rejects (".." and the like).
func fsName(urlPath, prefix string) string {
	name, ok := strings.CutPrefix(urlPath, prefix)
	if !ok || name == "" || !fs.ValidPath(name) {
		return ""
	}
	for elem := range strings.SplitSeq(name, "/") {
		if strings.HasPrefix(elem, ".") {
			return ""
		}
	}
	return name
}

// isCustom reports whether name is a custom*.* file directly under scripts/.
func isCustom(name string) bool {
	ok, err := path.Match("custom*.*", name)
	return err == nil && ok
}

func (s *Server) serveFrom(w http.ResponseWriter, r *http.Request, t tree, name string) {
	if name == "" || !t.serve(w, r, name, s.logger) {
		http.NotFound(w, r)
	}
}

func (s *Server) serveSite(w http.ResponseWriter, r *http.Request) {
	s.serveFrom(w, r, s.site, fsName(r.URL.Path, "/"))
}

// serveScripts serves /scripts/: custom*.* from the custom dir first (the
// /app/server/scripts/custom.js mount), everything else from the scripts tree.
func (s *Server) serveScripts(w http.ResponseWriter, r *http.Request) {
	name := fsName(r.URL.Path, "/scripts/")
	if isCustom(name) && s.custom.serve(w, r, name, s.logger) {
		return
	}
	s.serveFrom(w, r, s.scripts, name)
}

// serveMusic serves /music/: the music dir first (the /app/server/music mount), then the
// site's music/ folder (the bundled tracks).
func (s *Server) serveMusic(w http.ResponseWriter, r *http.Request) {
	name := fsName(r.URL.Path, "/music/")
	if name != "" && s.music.serve(w, r, name, s.logger) {
		return
	}
	if name != "" {
		name = "music/" + name
	}
	s.serveFrom(w, r, s.site, name)
}

// serveDevResources serves /resources/ from server/scripts/modules, as the Node dev
// server did; the production build has a real resources/ folder instead.
func (s *Server) serveDevResources(w http.ResponseWriter, r *http.Request) {
	s.serveFrom(w, r, s.resources, fsName(r.URL.Path, "/resources/"))
}
