package server

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
)

// Markers in web/views/index.ejs; build-consistency.test.mjs pins how often each appears.
const (
	serverStart    = "<!--ws4kp:server-->"
	serverEnd      = "<!--/ws4kp:server-->"
	overridesStart = "/*ws4kp:overrides*/"
	overridesEnd   = "/*/ws4kp:overrides*/"
	serverScript   = "<script>window.WS4KP_SERVER_AVAILABLE = true;</script>"
	kioskClass     = `class="kiosk"`
)

// RenderOptions are the per-request values the index carries.
type RenderOptions struct {
	// Server emits window.WS4KP_SERVER_AVAILABLE, which turns on the browser's use of the
	// proxies. False in static mode, where the built span (empty) is left as it is.
	Server bool
	// Overrides is the JSON written between every pair of overrides markers, as
	// OverridesJSON builds it; nil writes {}.
	Overrides []byte
	// Kiosk adds class="kiosk" to the first <body tag unless it already has it.
	Kiosk bool
}

// Render returns html with the markers' spans filled in for one request. html is the
// built dist/index.html, or web/.dev/index.html in dev mode.
func Render(html []byte, opts RenderOptions) []byte {
	out := bytes.Clone(html)
	if opts.Server {
		out = fill(out, serverStart, serverEnd, []byte(serverScript))
	}
	overrides := opts.Overrides
	if overrides == nil {
		overrides = []byte("{}")
	}
	out = fill(out, overridesStart, overridesEnd, overrides)
	if opts.Kiosk {
		out = addKiosk(out)
	}
	return out
}

// OverridesJSON encodes the runtime OVERRIDE_* values once, for every Render: keys sorted,
// and <, > and & escaped, because the JSON sits inside a <script> and a value containing
// </script> must not end it (JavaScript reads the escapes as the characters). Invalid UTF-8
// becomes U+FFFD.
func OverridesJSON(overrides map[string]string) ([]byte, error) {
	if overrides == nil {
		overrides = map[string]string{}
	}
	data, err := json.Marshal(overrides, json.Deterministic(true), jsontext.EscapeForHTML(true), jsontext.AllowInvalidUTF8(true))
	if err != nil {
		return nil, fmt.Errorf("encode OVERRIDES: %w", err)
	}
	return data, nil
}

// checkMarkers fails unless html has exactly one server span and one overrides span: the
// built index renders one of index.ejs's two OVERRIDES lines (production or development).
// A template edit that loses or doubles a marker would otherwise turn off the proxies,
// or the runtime OVERRIDES, without a word.
func checkMarkers(html []byte) error {
	var errs []error
	for _, m := range []string{serverStart, serverEnd, overridesStart, overridesEnd} {
		if n := bytes.Count(html, []byte(m)); n != 1 {
			errs = append(errs, fmt.Errorf("marker %s appears %d times, want 1", m, n))
		}
	}
	return errors.Join(errs...)
}

// fill replaces what sits between every start and end marker with content.
func fill(html []byte, start, end string, content []byte) []byte {
	var out bytes.Buffer
	for {
		before, rest, found := bytes.Cut(html, []byte(start))
		if !found {
			out.Write(html)
			return out.Bytes()
		}
		_, after, closed := bytes.Cut(rest, []byte(end))
		if !closed {
			out.Write(html)
			return out.Bytes()
		}
		out.Write(before)
		out.WriteString(start)
		out.Write(content)
		out.WriteString(end)
		html = after
	}
}

func addKiosk(html []byte) []byte {
	i := bytes.Index(html, []byte("<body"))
	if i < 0 {
		return html
	}
	tagEnd := bytes.IndexByte(html[i:], '>')
	if tagEnd < 0 || bytes.Contains(html[i:i+tagEnd], []byte(kioskClass)) {
		return html
	}
	at := i + len("<body")
	return bytes.Join([][]byte{html[:at], []byte(" " + kioskClass), html[at:]}, nil)
}
