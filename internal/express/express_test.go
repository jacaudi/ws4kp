package express

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// Expected values are what Node 26 prints for
// new URLSearchParams(require('node:querystring').parse(raw)).toString().
func TestQueryRoundTripMatchesNode(t *testing.T) {
	tests := []struct {
		raw, want string
	}{
		{"a=1&a=2", "a=1%2C2"},
		{"u=x&b=2", "u=x&b=2"},
		{"q=a+b", "q=a+b"},
		{"q=%7E*~", "q=%7E*%7E"},
		{"x", "x="},
		{"&&a=1&", "a=1"},
		{"bad=%zz", "bad=%25zz"},
		{"b=1&a=2&b=3", "b=1%2C3&a=2"},
		{"k=%E2%9C%93", "k=%E2%9C%93"},
		{"k=%FF", "k=%EF%BF%BD"},
		{"sp=a%20b", "sp=a+b"},
		{"=v", "=v"},
		{"c=a,b", "c=a%2Cb"},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			if got := EncodeQuery(ParseQuery(tt.raw)); got != tt.want {
				t.Errorf("EncodeQuery(ParseQuery(%q)) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestParseQueryEmptyForms(t *testing.T) {
	for _, raw := range []string{"", "&", "&&"} {
		if got := ParseQuery(raw); len(got) != 0 {
			t.Errorf("ParseQuery(%q) = %v, want no params", raw, got)
		}
	}
}

func TestLookup(t *testing.T) {
	params := ParseQuery("kiosk=true&a=1&a=2")
	if got := Lookup(params, "kiosk"); !slices.Equal(got, []string{"true"}) {
		t.Errorf("Lookup kiosk = %v", got)
	}
	if got := Lookup(params, "a"); !slices.Equal(got, []string{"1", "2"}) {
		t.Errorf("Lookup a = %v", got)
	}
	if got := Lookup(params, "missing"); got != nil {
		t.Errorf("Lookup missing = %v, want nil", got)
	}
}

func TestWithCharset(t *testing.T) {
	tests := []struct{ in, want string }{
		{"application/geo+json", "application/geo+json; charset=utf-8"},
		{"text/html; charset=ISO-8859-1", "text/html; charset=utf-8"},
		{"Text/Plain; Profile=x", "text/plain; charset=utf-8; profile=x"},
		{"not a type;;", "not a type;;"},
	}
	for _, tt := range tests {
		if got := WithCharset(tt.in); got != tt.want {
			t.Errorf("WithCharset(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestSend(t *testing.T) {
	body := []byte("hello")
	etag := WeakETag(body)
	tests := []struct {
		name       string
		method     string
		status     int
		header     map[string]string
		wantStatus int
		wantBody   string
		wantLength string
	}{
		{"plain GET", http.MethodGet, 200, nil, 200, "hello", "5"},
		{"matching If-None-Match", http.MethodGet, 200, map[string]string{"If-None-Match": etag}, 304, "", ""},
		{"strong form of the weak tag matches", http.MethodGet, 200, map[string]string{"If-None-Match": `"x", ` + etag[2:]}, 304, "", ""},
		{"star matches", http.MethodGet, 200, map[string]string{"If-None-Match": "*"}, 304, "", ""},
		{"other tag", http.MethodGet, 200, map[string]string{"If-None-Match": `W/"other"`}, 200, "hello", "5"},
		{"no-cache request is never fresh", http.MethodGet, 200, map[string]string{"If-None-Match": etag, "Cache-Control": "no-cache"}, 200, "hello", "5"},
		{"If-Modified-Since alone is never fresh", http.MethodGet, 200, map[string]string{"If-Modified-Since": "Mon, 01 Jan 2024 00:00:00 GMT"}, 200, "hello", "5"},
		{"error status is never 304", http.MethodGet, 404, map[string]string{"If-None-Match": etag}, 404, "hello", "5"},
		{"POST is never 304", http.MethodPost, 200, map[string]string{"If-None-Match": etag}, 200, "hello", "5"},
		{"HEAD sends the length but no body", http.MethodHead, 200, nil, 200, "", "5"},
		{"204 strips the length", http.MethodGet, 204, nil, 204, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), tt.method, "/x", nil)
			for k, v := range tt.header {
				r.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			w.Header().Set("Content-Type", "text/plain")
			Send(w, r, tt.status, body)
			res := w.Result()
			if res.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", res.StatusCode, tt.wantStatus)
			}
			if got := w.Body.String(); got != tt.wantBody {
				t.Errorf("body = %q, want %q", got, tt.wantBody)
			}
			if got := res.Header.Get("Content-Length"); got != tt.wantLength {
				t.Errorf("Content-Length = %q, want %q", got, tt.wantLength)
			}
			if got := res.Header.Get("Etag"); got != etag {
				t.Errorf("ETag = %q, want %q", got, etag)
			}
			if tt.wantStatus == 304 && res.Header.Get("Content-Type") != "" {
				t.Errorf("304 kept Content-Type %q", res.Header.Get("Content-Type"))
			}
		})
	}
}

func TestWeakETagFormat(t *testing.T) {
	if got, want := WeakETag([]byte("{}")), `W/"44136fa355b3678a1146ad16f7e8649e"`; got != want {
		t.Errorf("WeakETag({}) = %s, want %s", got, want)
	}
}

func TestJSONMatchesJSONStringify(t *testing.T) {
	w := httptest.NewRecorder()
	JSON(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/cache/api/x", nil), 200, map[string]any{
		"path": "/api/x?a=1&b=<2>", "cleared": true,
	})
	if got, want := w.Body.String(), `{"cleared":true,"path":"/api/x?a=1&b=<2>"}`; got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
	if got := w.Header().Get("Content-Type"); got != JSONType {
		t.Errorf("Content-Type = %q, want %q", got, JSONType)
	}
}

// Encoding parsed parameters and parsing the result again gives back every key, each with
// its values comma-joined, and nothing else.
func FuzzParseQuery(f *testing.F) {
	for _, seed := range []string{"a=1&a=2", "u=x&b=2", "q=a+b", "bad=%zz", "=v", "k=%FF", "&&x"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		params := ParseQuery(raw)
		again := ParseQuery(EncodeQuery(params))
		if len(again) != len(params) {
			t.Fatalf("%q: %d params, %d after a round trip", raw, len(params), len(again))
		}
		for i, p := range params {
			if again[i].Key != p.Key || !slices.Equal(again[i].Values, []string{strings.Join(p.Values, ",")}) {
				t.Errorf("%q: param %d = %q, want %q=%q", raw, i, again[i], p.Key, strings.Join(p.Values, ","))
			}
		}
	})
}
