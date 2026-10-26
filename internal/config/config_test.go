package config

import (
	"bytes"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/spf13/pflag"

	"github.com/jacaudi/ws4kp/internal/express"
)

// setup runs the test in an empty directory (so no stray .env is read) with every
// variable Load reads unset, and returns a flag set and a logger whose output is captured.
func setup(t *testing.T) (*pflag.FlagSet, *slog.Logger, *bytes.Buffer) {
	t.Helper()
	t.Chdir(t.TempDir())
	for _, kv := range os.Environ() {
		key, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(key, "WSQS_") || strings.HasPrefix(key, "OVERRIDE_") {
			unset(t, key)
		}
	}
	for _, key := range []string{"WS4KP_PORT", "STATIC", "WS4KP_DEV", "WS4KP_WEB_DIR", "WS4KP_MUSIC_DIR", "WS4KP_CUSTOM_DIR", "DIST"} {
		unset(t, key)
	}
	flags := pflag.NewFlagSet("test", pflag.ContinueOnError)
	RegisterFlags(flags)
	var logs bytes.Buffer
	return flags, slog.New(slog.NewTextHandler(&logs, nil)), &logs
}

// unset removes key for the rest of the test; t.Setenv records the old value so it is
// restored afterwards.
func unset(t *testing.T, key string) {
	t.Helper()
	t.Setenv(key, "")
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
}

func writeDotEnv(t *testing.T, content string) {
	t.Helper()
	if err := os.WriteFile(DotEnvFile, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDefaults(t *testing.T) {
	flags, logger, logs := setup(t)
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	want := Config{Port: 8080, WebDir: "web", MusicDir: "/app/server/music", CustomDir: "/app/server/scripts", Overrides: map[string]string{}}
	if cfg.Port != want.Port || cfg.Static || cfg.Dev || cfg.WebDir != want.WebDir || cfg.MusicDir != want.MusicDir || cfg.CustomDir != want.CustomDir || len(cfg.Query) != 0 || len(cfg.Overrides) != 0 {
		t.Errorf("Load() = %+v, want %+v", cfg, want)
	}
	if logs.Len() != 0 {
		t.Errorf("unexpected log output: %s", logs)
	}
}

// Design §6.2.3's required test: .env keys keep their case, and a real variable wins.
func TestDotEnvKeepsCaseAndLosesToTheEnvironment(t *testing.T) {
	flags, logger, _ := setup(t)
	writeDotEnv(t, "WSQS_latLonQuery=Orlando\nOVERRIDE_RADAR_HOST=x.example\nWS4KP_PORT=9001\n")
	unset(t, "WSQS_latLonQuery")
	unset(t, "OVERRIDE_RADAR_HOST")
	t.Setenv("WS4KP_PORT", "9002")

	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if want := []express.Param{{Key: "latLonQuery", Values: []string{"Orlando"}}}; !slices.EqualFunc(cfg.Query, want, paramEqual) {
		t.Errorf("Query = %v, want %v", cfg.Query, want)
	}
	if got := cfg.Overrides["RADAR_HOST"]; got != "x.example" {
		t.Errorf(`Overrides["RADAR_HOST"] = %q, want "x.example"`, got)
	}
	if cfg.Port != 9002 {
		t.Errorf("Port = %d, want 9002 (the environment beats .env)", cfg.Port)
	}
}

// A .env written for Node's dotenv, through Load: comments, export, quotes, a value with
// "$" (never expanded), a prose line and a bare word (both skipped), and an empty value.
func TestDotEnvAsWrittenForDotenv(t *testing.T) {
	flags, logger, _ := setup(t)
	writeDotEnv(t, strings.Join([]string{
		"# a comment",
		"export OVERRIDE_A=plain",
		`OVERRIDE_B="double # not a comment"`,
		`OVERRIDE_C='single'`,
		"OVERRIDE_D=",
		"OVERRIDE_E=value # trailing comment",
		"OVERRIDE_F=costs $5 today",
		"OVERRIDE_G=${HOME}/music",
		"just some text",
		"export ONLYKEY",
		"",
	}, "\n"))
	for _, k := range []string{"OVERRIDE_A", "OVERRIDE_B", "OVERRIDE_C", "OVERRIDE_D", "OVERRIDE_E", "OVERRIDE_F", "OVERRIDE_G", "ONLYKEY"} {
		unset(t, k)
	}
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"A": "plain", "B": "double # not a comment", "C": "single", "D": "", "E": "value", "F": "costs $5 today", "G": "${HOME}/music"}
	if !maps.Equal(cfg.Overrides, want) {
		t.Errorf("Overrides = %q, want %q", cfg.Overrides, want)
	}
	if _, set := os.LookupEnv("ONLYKEY"); set {
		t.Error("`export ONLYKEY` set a variable; dotenv skips it")
	}
}

func TestPrecedenceFlagOverEnvOverDefault(t *testing.T) {
	flags, logger, _ := setup(t)
	t.Setenv("WS4KP_PORT", "9002")
	t.Setenv("WS4KP_MUSIC_DIR", "/env/music")
	if err := flags.Parse([]string{"--port", "9003"}); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9003 || cfg.MusicDir != "/env/music" {
		t.Errorf("Port, MusicDir = %d, %q; want 9003 (flag), /env/music (env)", cfg.Port, cfg.MusicDir)
	}
}

func TestStaticIsAnyNonEmptyValue(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{{"1", true}, {"true", true}, {"false", true}, {"", false}}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			flags, logger, _ := setup(t)
			t.Setenv("STATIC", tt.value)
			cfg, err := Load(flags, logger)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Static != tt.want {
				t.Errorf("STATIC=%q: Static = %v, want %v", tt.value, cfg.Static, tt.want)
			}
		})
	}
}

func TestDevDefaultsUnderWebDir(t *testing.T) {
	flags, logger, _ := setup(t)
	if err := os.Mkdir("web", 0o750); err != nil {
		t.Fatal(err)
	}
	if err := flags.Parse([]string{"--dev"}); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join("web", "server", "music"); cfg.MusicDir != want {
		t.Errorf("MusicDir = %q, want %q", cfg.MusicDir, want)
	}
	if want := filepath.Join("web", "server", "scripts"); cfg.CustomDir != want {
		t.Errorf("CustomDir = %q, want %q", cfg.CustomDir, want)
	}
}

func TestPrefixScans(t *testing.T) {
	flags, logger, _ := setup(t)
	t.Setenv("WSQS_settings_wide_checkbox", "true")
	t.Setenv("WSQS_bad-key", "ignored: a hyphen does not match ^WSQS_[A-Za-z0-9_]+$")
	t.Setenv("OVERRIDE_OVERRIDE_X", "only the first prefix is removed")
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if want := []express.Param{{Key: "settings-wide-checkbox", Values: []string{"true"}}}; !slices.EqualFunc(cfg.Query, want, paramEqual) {
		t.Errorf("Query = %v, want %v", cfg.Query, want)
	}
	if got := cfg.Overrides["OVERRIDE_X"]; got != "only the first prefix is removed" {
		t.Errorf(`Overrides["OVERRIDE_X"] = %q`, got)
	}
}

func TestValidationErrors(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		args    []string
		wantErr []string
	}{
		{"port not a number", map[string]string{"WS4KP_PORT": "eighty"}, nil, []string{"decode config"}},
		{"port out of range", map[string]string{"WS4KP_PORT": "70000"}, nil, []string{"port 70000"}},
		{"port zero", nil, []string{"--port", "0"}, []string{"port 0"}},
		{"dev not a boolean", map[string]string{"WS4KP_DEV": "maybe"}, nil, []string{"decode config"}},
		{"dev without a web dir, and a bad port: both reported", map[string]string{"WS4KP_PORT": "0"}, []string{"--dev", "--web-dir", "missing"}, []string{"port 0", `web dir "missing"`}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			flags, logger, _ := setup(t)
			for k, v := range tt.env {
				t.Setenv(k, v)
			}
			if err := flags.Parse(tt.args); err != nil {
				t.Fatal(err)
			}
			_, err := Load(flags, logger)
			if err == nil {
				t.Fatal("Load() succeeded, want an error")
			}
			for _, want := range tt.wantErr {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q does not mention %q", err, want)
				}
			}
		})
	}
}

func TestDistIsIgnoredWithOneWarning(t *testing.T) {
	flags, logger, logs := setup(t)
	t.Setenv("DIST", "1")
	if _, err := Load(flags, logger); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(logs.String(), "level=WARN msg=\"DIST is ignored; the binary always serves the embedded build\""); got != 1 {
		t.Errorf("want exactly one DIST warning, got %d in:\n%s", got, logs)
	}
}

// dotenvCases are inputs with the map dotenv 18.0.8's parse() returns for each (the first
// twelve are the cases a gotenv-based loader got wrong).
var dotenvCases = []struct {
	name, text string
	want       map[string]string
}{
	{"1-dollar-digit", "OVERRIDE_PRICE=costs $5 today\n", map[string]string{"OVERRIDE_PRICE": "costs $5 today"}},
	{"10-empty-key", "WS4KP_PORT=9000\n=novalue\n", map[string]string{"WS4KP_PORT": "9000"}},
	{"11-crlf", "WS4KP_PORT=9000\r\nOVERRIDE_X=y\r\nOVERRIDE_Q=\"quoted\"\r\n", map[string]string{"WS4KP_PORT": "9000", "OVERRIDE_X": "y", "OVERRIDE_Q": "quoted"}},
	{"12-bom", "\uFEFFWS4KP_PORT=9000\n", map[string]string{"WS4KP_PORT": "9000"}},
	{"2-dollar-var", "OVERRIDE_TPL=${HOME}/music\n", map[string]string{"OVERRIDE_TPL": "${HOME}/music"}},
	{"3-dq-dollar", "OVERRIDE_Q=\"say $USER\"\n", map[string]string{"OVERRIDE_Q": "say $USER"}},
	{"4-prose-line", "note: this file is for ws4kp\nWS4KP_PORT=9000\n", map[string]string{"note": "this file is for ws4kp", "WS4KP_PORT": "9000"}},
	{"5-bare-text", "just some text\nWS4KP_PORT=9000\n", map[string]string{"WS4KP_PORT": "9000"}},
	{"6-export-no-value", "export ONLYKEY\nWS4KP_PORT=9000\n", map[string]string{"WS4KP_PORT": "9000"}},
	{"7-backtick", "OVERRIDE_BT=`backtick`\n", map[string]string{"OVERRIDE_BT": "backtick"}},
	{"8-hyphen-key", "WSQS_foo-bar=1\nWS4KP_PORT=9000\n", map[string]string{"WSQS_foo-bar": "1", "WS4KP_PORT": "9000"}},
	{"9-hash-in-unquoted", "OVERRIDE_URL=http://x.example/a#frag\n", map[string]string{"OVERRIDE_URL": "http://x.example/a"}},
	{"plain", "A=1\n", map[string]string{"A": "1"}},
	{"spaces-around", "A = spaced value  \n", map[string]string{"A": "spaced value"}},
	{"single-quote-no-escape", "A='a\\nb'\n", map[string]string{"A": "a\\nb"}},
	{"double-quote-escapes", "A=\"a\\nb\\rc\"\n", map[string]string{"A": "a\nb\rc"}},
	{"double-quote-escaped-quote", "A=\"say \\\"hi\\\"\"\n", map[string]string{"A": "say \\\"hi\\\""}},
	{"hash-in-quotes", "A=\"x # not a comment\"\n", map[string]string{"A": "x # not a comment"}},
	{"trailing-comment", "A=value # comment\n", map[string]string{"A": "value"}},
	{"comment-line", "# A=1\nB=2\n", map[string]string{"B": "2"}},
	{"empty", "A=\n", map[string]string{"A": ""}},
	{"colon-form", "A: value\n", map[string]string{"A": "value"}},
	{"multiline-dq", "A=\"line1\nline2\"\nB=2\n", map[string]string{"A": "line1\nline2", "B": "2"}},
	{"unterminated", "A='abc\nB=2\n", map[string]string{"A": "'abc", "B": "2"}},
	{"dq-then-junk", "A=\"abc\" junk\n", map[string]string{"A": "\"abc\" junk"}},
	{"export", "export A=1\n", map[string]string{"A": "1"}},
	{"dots-dashes", "A.B-C=1\n", map[string]string{"A.B-C": "1"}},
	{"duplicate", "A=1\nA=2\n", map[string]string{"A": "2"}},
	{"cr-only", "A=1\rB=2\r", map[string]string{"A": "1", "B": "2"}},
	{"tab-value", "A=\tx\t\n", map[string]string{"A": "x"}},
	{"no-newline-eof", "A=1", map[string]string{"A": "1"}},
	{"nbsp-before-key", "\u00A0A=1\n", map[string]string{"A": "1"}},
	{"backtick-with-quotes", "A=`it's \"x\"`\n", map[string]string{"A": "it's \"x\""}},
	{"blank-lines", "\n\n  A=1\n\n", map[string]string{"A": "1"}},
}

func asMap(env []envVar) map[string]string {
	m := map[string]string{}
	for _, v := range env {
		m[v.Key] = v.Value
	}
	return m
}

func TestParseDotenvMatchesDotenv18(t *testing.T) {
	for _, tt := range dotenvCases {
		t.Run(tt.name, func(t *testing.T) {
			got := parseDotenv(tt.text)
			if m := asMap(got); !maps.Equal(m, tt.want) || len(got) != len(m) {
				t.Errorf("parseDotenv(%q) = %q, want %q", tt.text, got, tt.want)
			}
		})
	}
}

func TestParseDotenvKeepsFileOrder(t *testing.T) {
	got := parseDotenv("B=1\nA=2\nB=3\nC=4\n")
	want := []envVar{{"B", "3"}, {"A", "2"}, {"C", "4"}} // a repeat keeps its first place and last value
	if !slices.Equal(got, want) {
		t.Errorf("parseDotenv = %q, want %q", got, want)
	}
}

// FuzzParseDotenv starts from the table's inputs: no input panics or yields a key outside
// dotenv's [\w.-]+, and a table input still parses to the table's map.
func FuzzParseDotenv(f *testing.F) {
	want := map[string]map[string]string{}
	for _, tt := range dotenvCases {
		f.Add(tt.text)
		want[tt.text] = tt.want
	}
	key := regexp.MustCompile(`^[\w.-]+$`)
	f.Fuzz(func(t *testing.T, text string) {
		got := parseDotenv(text)
		for _, v := range got {
			if !key.MatchString(v.Key) {
				t.Errorf("parseDotenv(%q) produced key %q", text, v.Key)
			}
		}
		if w, seeded := want[text]; seeded && !maps.Equal(asMap(got), w) {
			t.Errorf("parseDotenv(%q) = %q, want %q", text, got, w)
		}
	})
}

// WSQS_ variables from .env keep the file's order, so the 307 Location lists them in it.
func TestDotEnvKeepsTheQueryInFileOrder(t *testing.T) {
	flags, logger, _ := setup(t)
	writeDotEnv(t, "WSQS_zoom=1\nWSQS_alpha=2\nWSQS_middle=3\n")
	for _, k := range []string{"WSQS_zoom", "WSQS_alpha", "WSQS_middle"} {
		unset(t, k)
	}
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if got := express.EncodeQuery(cfg.Query); got != "zoom=1&alpha=2&middle=3" {
		t.Errorf("query = %s, want zoom=1&alpha=2&middle=3", got)
	}
}

// A .env the server cannot read (EACCES under the image's uid 65532) is skipped with one
// warning, as dotenv carried on without it.
func TestUnreadableDotEnvIsIgnoredWithAWarning(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	flags, logger, logs := setup(t)
	writeDotEnv(t, "WS4KP_PORT=9001\n")
	if err := os.Chmod(DotEnvFile, 0); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want the default 8080", cfg.Port)
	}
	if got := strings.Count(logs.String(), `level=WARN msg="cannot read .env; ignoring it"`); got != 1 {
		t.Errorf("want one warning, got %d in:\n%s", got, logs)
	}
}

// Node read the environment as UTF-8: an invalid byte reached the page as U+FFFD.
func TestInvalidUTF8ValuesBecomeReplacementCharacters(t *testing.T) {
	flags, logger, _ := setup(t)
	t.Setenv("OVERRIDE_TITLE", "Caf\xe9")
	t.Setenv("WSQS_place", "Caf\xe9")
	cfg, err := Load(flags, logger)
	if err != nil {
		t.Fatal(err)
	}
	want := "Caf" + string(utf8.RuneError)
	if got := cfg.Overrides["TITLE"]; got != want {
		t.Errorf(`Overrides["TITLE"] = %q, want %q`, got, want)
	}
	if got := express.Lookup(cfg.Query, "place"); !slices.Equal(got, []string{want}) {
		t.Errorf("Query place = %q, want %q", got, want)
	}
}

func paramEqual(a, b express.Param) bool {
	return a.Key == b.Key && slices.Equal(a.Values, b.Values)
}
