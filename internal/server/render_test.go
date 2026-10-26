package server

import (
	"bytes"
	"encoding/json/v2"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// testdata/index.html is web/dist/index.html from `npm --prefix web run build` with no
// OVERRIDE_* variables set: its server span is empty and its overrides are {}.
func fixture(t *testing.T) []byte {
	t.Helper()
	html, err := os.ReadFile(filepath.Join("testdata", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	return html
}

func overridesJSON(t *testing.T, overrides map[string]string) []byte {
	t.Helper()
	data, err := OverridesJSON(overrides)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRenderAgainstTheBuiltIndex(t *testing.T) {
	html := fixture(t)
	if err := checkMarkers(html); err != nil {
		t.Fatalf("fixture: %v; rebuild it (see Task 1)", err)
	}
	for _, marker := range []string{serverStart + serverEnd, overridesStart + "{}" + overridesEnd, "<body>"} {
		if bytes.Count(html, []byte(marker)) != 1 {
			t.Errorf("fixture must contain %q exactly once; rebuild it (see Task 1)", marker)
		}
	}
	if t.Failed() {
		t.FailNow()
	}
	for _, server := range []bool{true, false} {
		for _, overrides := range []map[string]string{{"RADAR_HOST": "x.example"}, nil} {
			for _, kiosk := range []bool{true, false} {
				t.Run(fmt.Sprintf("server=%v overrides=%v kiosk=%v", server, overrides != nil, kiosk), func(t *testing.T) {
					got := Render(html, RenderOptions{Server: server, Overrides: overridesJSON(t, overrides), Kiosk: kiosk})
					wantServer := serverStart + serverEnd
					if server {
						wantServer = serverStart + serverScript + serverEnd
					}
					wantOverrides := overridesStart + "{}" + overridesEnd
					if overrides != nil {
						wantOverrides = overridesStart + `{"RADAR_HOST":"x.example"}` + overridesEnd
					}
					wantBody := "<body>"
					if kiosk {
						wantBody = `<body class="kiosk">`
					}
					for _, want := range []string{wantServer, wantOverrides, wantBody} {
						if c := bytes.Count(got, []byte(want)); c != 1 {
							t.Errorf("output contains %q %d times, want 1", want, c)
						}
					}
					// nothing else changes
					restored := strings.NewReplacer(wantServer, serverStart+serverEnd, wantOverrides, overridesStart+"{}"+overridesEnd, wantBody, "<body>").Replace(string(got))
					if restored != string(html) {
						t.Error("Render changed bytes outside the three spans")
					}
				})
			}
		}
	}
}

func TestRenderKioskForms(t *testing.T) {
	tests := []struct{ in, want string }{
		{"<html><body>x</body>", `<html><body class="kiosk">x</body>`},
		{"<html><body >x</body>", `<html><body class="kiosk" >x</body>`}, // the dev index (unminified EJS output)
		{`<html><body class="kiosk">x</body>`, `<html><body class="kiosk">x</body>`},
		{"<html>no body tag</html>", "<html>no body tag</html>"},
		{"<body><p>a</p><body>", `<body class="kiosk"><p>a</p><body>`},
	}
	for _, tt := range tests {
		if got := Render([]byte(tt.in), RenderOptions{Kiosk: true}); string(got) != tt.want {
			t.Errorf("Render(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestRenderEscapesOverridesForAScriptBlock(t *testing.T) {
	overrides := map[string]string{"B": "</script><script>alert(1)", "A": "a&b"}
	got := Render([]byte("<script>const OVERRIDES = "+overridesStart+"{}"+overridesEnd+";</script>"), RenderOptions{Overrides: overridesJSON(t, overrides)})
	_, rest, _ := bytes.Cut(got, []byte(overridesStart))
	span, _, _ := bytes.Cut(rest, []byte(overridesEnd))
	if bytes.ContainsAny(span, "<>&") {
		t.Errorf("OVERRIDES JSON is not escaped for a <script> block: %s", span)
	}
	var decoded map[string]string
	if err := json.Unmarshal(span, &decoded); err != nil || !maps.Equal(decoded, overrides) {
		t.Errorf("OVERRIDES JSON %s decodes to %v (%v), want %v", span, decoded, err, overrides)
	}
	if !bytes.HasPrefix(span, []byte(`{"A":`)) {
		t.Errorf("keys are not sorted: %s", span)
	}
}

func TestRenderReplacesEveryOverridesSpan(t *testing.T) {
	in := []byte(overridesStart + `{"OLD":"1"}` + overridesEnd + " " + overridesStart + "{}" + overridesEnd)
	got := Render(in, RenderOptions{Overrides: overridesJSON(t, map[string]string{"NEW": "2"})})
	if want := strings.Repeat(overridesStart+`{"NEW":"2"}`+overridesEnd+" ", 2); string(got)+" " != want {
		t.Errorf("got %s", got)
	}
}

func TestOverridesJSONReplacesInvalidUTF8(t *testing.T) {
	want := `{"TITLE":"Caf` + string(utf8.RuneError) + `"}`
	if got := string(overridesJSON(t, map[string]string{"TITLE": "Caf\xe9"})); got != want {
		t.Errorf("OverridesJSON = %s, want %s", got, want)
	}
}

func TestCheckMarkers(t *testing.T) {
	ok := serverStart + serverEnd + "<script>const OVERRIDES = " + overridesStart + "{}" + overridesEnd + ";</script>"
	tests := []struct {
		name, html, wantErr string
	}{
		{"one of each", ok, ""},
		{"no server span", strings.ReplaceAll(ok, serverStart+serverEnd, ""), "<!--ws4kp:server--> appears 0 times"},
		{"two overrides spans", ok + overridesStart + "{}" + overridesEnd, "/*ws4kp:overrides*/ appears 2 times"},
	}
	for _, tt := range tests {
		err := checkMarkers([]byte(tt.html))
		switch {
		case tt.wantErr == "" && err != nil:
			t.Errorf("%s: %v", tt.name, err)
		case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
			t.Errorf("%s: err = %v, want it to mention %q", tt.name, err, tt.wantErr)
		}
	}
}
