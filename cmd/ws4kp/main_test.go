package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuffer is a bytes.Buffer safe to read while the server goroutine writes logs.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func runArgs(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut syncBuffer
	code = run(t.Context(), args, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := runArgs(t, "--version")
	if code != 0 || out != "ws4kp version dev\n" {
		t.Errorf("--version = %d %q", code, out)
	}
}

func TestUsageErrorsExit2(t *testing.T) {
	for _, args := range [][]string{{"--log-format", "xml"}, {"--log-level", "loud"}, {"--no-such-flag"}, {"extra-arg"}, {"healthcheck", "extra"}} {
		if code, _, _ := runArgs(t, args...); code != 2 {
			t.Errorf("%v exit = %d, want 2", args, code)
		}
	}
}

// A startup failure is a JSON log line on stdout, like every other log line, and is not
// printed a second time.
func TestBadConfigExits1WithALogLine(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("WS4KP_PORT", "70000")
	code, stdout, stderr := runArgs(t)
	if code != 1 || !strings.Contains(stdout, `"level":"ERROR","msg":"ws4kp stopped"`) || !strings.Contains(stdout, "port 70000") || stderr != "" {
		t.Errorf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}

func TestUsageErrorIsPrintedOnce(t *testing.T) {
	_, _, stderr := runArgs(t, "--no-such-flag")
	if strings.Count(stderr, "unknown flag: --no-such-flag") != 1 {
		t.Errorf("stderr = %q", stderr)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	return port
}

// devWeb lays out the parts of web/ that --dev reads.
func devWeb(t *testing.T) string {
	t.Helper()
	web := t.TempDir()
	files := map[string]string{
		".dev/index.html":      "<html><!--ws4kp:server--><!--/ws4kp:server--><script>const OVERRIDES = /*ws4kp:overrides*/{}/*/ws4kp:overrides*/;</script><body></body></html>",
		"server/manifest.json": "{}",
	}
	for _, name := range []string{"travelcities.json", "regionalcities.json", "stations.json"} {
		files["datagenerators/output/"+name] = "[]"
	}
	var errs []error
	for name, content := range files {
		path := filepath.Join(web, name)
		errs = append(errs, os.MkdirAll(filepath.Dir(path), 0o750), os.WriteFile(path, []byte(content), 0o600))
	}
	if err := errors.Join(errs...); err != nil {
		t.Fatal(err)
	}
	return web
}

// TestServeAndHealthcheck starts the real command in dev mode, probes it with the
// healthcheck subcommand, and stops it by cancelling its context.
func TestServeAndHealthcheck(t *testing.T) {
	t.Chdir(t.TempDir())
	port := strconv.Itoa(freePort(t))
	if code, _, _ := runArgs(t, "healthcheck", "--port", port); code != 1 {
		t.Fatalf("healthcheck with nothing listening = %d, want 1", code)
	}

	ctx, cancel := context.WithCancel(t.Context())
	var out, errOut syncBuffer
	done := make(chan int, 1)
	args := []string{"--dev", "--web-dir", devWeb(t), "--port", port, "--log-format", "text"}
	go func() {
		done <- run(ctx, args, &out, &errOut)
	}()
	healthy := false
	for deadline := time.Now().Add(5 * time.Second); !healthy && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		code, _, _ := runArgs(t, "healthcheck", "--port", port)
		healthy = code == 0
	}
	cancel()
	code := <-done // drain before any failure, so the goroutine never outlives the test
	if !healthy {
		t.Fatalf("server never became healthy; exit %d, stdout %q stderr %q", code, out.String(), errOut.String())
	}
	if code != 0 {
		t.Errorf("serve exit = %d; stderr %q", code, errOut.String())
	}
	for _, want := range []string{"level=INFO msg=listening addr=", ":" + port + " version=dev dev=true static=false", "level=INFO msg=stopped"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("logs lack %q:\n%s", want, out.String())
		}
	}
}

// healthcheck reads the port and nothing else: a dev-mode environment with no web/
// directory (the server's own settings, inherited by the probe) must not make it fail.
func TestHealthcheckIgnoresDevModeSettings(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("WS4KP_DEV", "1")
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, err := io.WriteString(w, "{}"); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(up.Close)
	_, port, err := net.SplitHostPort(up.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := runArgs(t, "healthcheck", "--port", port); code != 0 {
		t.Errorf("healthcheck with WS4KP_DEV=1 and no web/ = %d; stderr %q", code, stderr)
	}
	// the server's other flags are not the healthcheck's
	if code, _, _ := runArgs(t, "healthcheck", "--dev"); code != 2 {
		t.Errorf("healthcheck --dev = %d, want 2 (unknown flag)", code)
	}
}
