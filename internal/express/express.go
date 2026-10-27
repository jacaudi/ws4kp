// Package express reproduces the response and query-string behaviors of the Node/Express
// server this binary replaced, wherever the browser app or a cache can observe them:
// res.send's weak ETag and 304 handling, res.json's content type, Express's "simple" query
// parser (Node's querystring.parse) and URLSearchParams serialization.
package express

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// JSONType is the Content-Type Express's res.json sends.
const JSONType = "application/json; charset=utf-8"

// HTMLType is the Content-Type Express's res.send sends for a string body with no type set.
const HTMLType = "text/html; charset=utf-8"

// Param is one query-string key and every value it was given, in order of appearance.
type Param struct {
	Key    string
	Values []string
}

// ParseQuery parses a raw query string (no leading '?') the way Node's querystring.parse
// does: pieces split on '&', empty pieces skipped, the key ends at the first '=', '+' is a
// space, and a malformed percent escape is kept literally instead of failing the parse.
// A key that repeats keeps its first position and collects every value.
//
// Two differences from Node remain. Keys keep their order of appearance, where a
// JavaScript object puts integer-like keys ("1", "2") first in ascending order. And a run
// of bytes that is not UTF-8 becomes one U+FFFD, where Node writes one per invalid
// sequence. Both only change the bytes of a re-encoded upstream URL, never which
// parameters it carries.
func ParseQuery(raw string) []Param {
	var params []Param
	index := map[string]int{}
	for piece := range strings.SplitSeq(raw, "&") {
		if piece == "" {
			continue
		}
		k, v, _ := strings.Cut(piece, "=")
		key, value := unescape(k), unescape(v)
		if i, seen := index[key]; seen {
			params[i].Values = append(params[i].Values, value)
			continue
		}
		index[key] = len(params)
		params = append(params, Param{Key: key, Values: []string{value}})
	}
	return params
}

// Lookup returns the values given for key, or nil.
func Lookup(params []Param, key string) []string {
	for _, p := range params {
		if p.Key == key {
			return p.Values
		}
	}
	return nil
}

// unescape decodes '+' and every well-formed %XX escape; anything else is kept as is.
// Bytes that do not form UTF-8 become U+FFFD, as Node's Buffer.toString does.
func unescape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '+':
			b.WriteByte(' ')
		case s[i] == '%' && i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]):
			b.WriteByte(unhex(s[i+1])<<4 | unhex(s[i+2]))
			i += 2
		default:
			b.WriteByte(s[i])
		}
	}
	return strings.ToValidUTF8(b.String(), string(utf8.RuneError))
}

func isHex(c byte) bool {
	return '0' <= c && c <= '9' || 'a' <= c && c <= 'f' || 'A' <= c && c <= 'F'
}

func unhex(c byte) byte {
	switch {
	case c <= '9':
		return c - '0'
	case c <= 'F':
		return c - 'A' + 10
	default:
		return c - 'a' + 10
	}
}

// EncodeQuery serializes params the way `new URLSearchParams(object).toString()` does in
// Node: in order, a repeated key's values joined into one comma-separated value, and each
// key and value form-urlencoded (space as '+', only ALPHA / DIGIT / "*-._" left bare).
func EncodeQuery(params []Param) string {
	var b strings.Builder
	for i, p := range params {
		if i > 0 {
			b.WriteByte('&')
		}
		formEncode(&b, p.Key)
		b.WriteByte('=')
		formEncode(&b, strings.Join(p.Values, ","))
	}
	return b.String()
}

func formEncode(b *strings.Builder, s string) {
	const upperhex = "0123456789ABCDEF"
	for i := range len(s) {
		c := s[i]
		switch {
		case c == ' ':
			b.WriteByte('+')
		case 'a' <= c && c <= 'z', 'A' <= c && c <= 'Z', '0' <= c && c <= '9', c == '*', c == '-', c == '.', c == '_':
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(upperhex[c>>4])
			b.WriteByte(upperhex[c&15])
		}
	}
}

// WithCharset returns contentType with its charset parameter set to utf-8, as Express's
// res.send does for a string body. A value that does not parse is returned unchanged.
func WithCharset(contentType string) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return contentType
	}
	params["charset"] = "utf-8"
	return mime.FormatMediaType(mediaType, params)
}

// Send writes body the way Express's res.send does once the Content-Type is set: a weak
// ETag computed from the body, 304 Not Modified when a GET or HEAD for a 2xx response
// carries a matching If-None-Match, a Content-Length, and no body for HEAD.
func Send(w http.ResponseWriter, r *http.Request, status int, body []byte) {
	h := w.Header()
	etag := WeakETag(body)
	h.Set("Etag", etag)
	if status >= 200 && status < 300 && fresh(r, etag) {
		status = http.StatusNotModified
	}
	switch status {
	case http.StatusNoContent, http.StatusNotModified:
		h.Del("Content-Type")
		h.Del("Content-Length")
		w.WriteHeader(status)
		return
	case http.StatusResetContent:
		body = nil
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := w.Write(body); err != nil {
		return // the client went away; there is no one left to tell
	}
}

// JSON writes v as Express's res.json does: JSON.stringify output (no HTML escaping),
// Content-Type application/json; charset=utf-8, then Send.
func JSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	body, err := Marshal(v)
	if err != nil {
		http.Error(w, fmt.Sprintf("encode response: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", JSONType)
	Send(w, r, status, body)
}

// Marshal encodes v as JSON.stringify would: no HTML escaping, and map keys sorted so the
// output is stable.
func Marshal(v any) ([]byte, error) {
	body, err := json.Marshal(v, json.Deterministic(true), jsontext.EscapeForHTML(false))
	if err != nil {
		return nil, fmt.Errorf("marshal json: %w", err)
	}
	return body, nil
}

// WeakETag returns a weak validator for body: W/"<first 16 bytes of its SHA-256, hex>".
func WeakETag(body []byte) string {
	sum := sha256.Sum256(body)
	return `W/"` + hex.EncodeToString(sum[:16]) + `"`
}

var noCacheRE = regexp.MustCompile(`(?:^|,)\s*?no-cache\s*?(?:,|$)`)

// fresh is the `fresh` package's test as Express applies it to res.send responses. Those
// responses never carry Last-Modified, so If-Modified-Since alone never matches.
func fresh(r *http.Request, etag string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	noneMatch := r.Header.Get("If-None-Match")
	if noneMatch == "" || noCacheRE.MatchString(r.Header.Get("Cache-Control")) {
		return false
	}
	if noneMatch == "*" {
		return true
	}
	for token := range strings.SplitSeq(noneMatch, ",") {
		token = strings.TrimSpace(token)
		if token == etag || "W/"+token == etag || token == "W/"+etag {
			return true
		}
	}
	return false
}
