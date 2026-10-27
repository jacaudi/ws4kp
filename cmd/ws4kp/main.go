// Command ws4kp serves the WeatherStar 4000+ simulator: the embedded browser app, the
// caching proxy in front of the weather services it reads, and the bundled music.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/jacaudi/ws4kp/internal/config"
	"github.com/jacaudi/ws4kp/internal/server"
	"github.com/jacaudi/ws4kp/web"
)

// version is set at build time: -ldflags "-X main.version=8.0.0".
var version = "dev"

// usageError marks a bad invocation, which exits 2 instead of 1.
type usageError struct{ error }

func (e usageError) Unwrap() error { return e.error }

// loggedError is a failure already written to the log, so run does not print it again.
type loggedError struct{ error }

func (e loggedError) Unwrap() error { return e.error }

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}

// run executes the command line and returns the exit code: 0 success, 1 failure, 2 usage.
// A serving failure is logged (JSON on stdout by default, like every other log line); any
// other error is printed to stderr once.
func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	cmd := newRootCmd()
	cmd.SetArgs(args)
	cmd.SetOut(stdout)
	cmd.SetErr(stderr)
	err := cmd.ExecuteContext(ctx)
	if err == nil {
		return 0
	}
	if _, logged := errors.AsType[loggedError](err); !logged {
		if _, err := fmt.Fprintln(stderr, "Error:", err); err != nil {
			return 1
		}
	}
	if _, usage := errors.AsType[usageError](err); usage {
		return 2
	}
	return 1
}

func noArgs(cmd *cobra.Command, args []string) error {
	if err := cobra.NoArgs(cmd, args); err != nil {
		return usageError{err}
	}
	return nil
}

func newRootCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ws4kp",
		Short: "Serve the WeatherStar 4000+ simulator",
		Long: "ws4kp serves the WeatherStar 4000+ browser app from the files built into the binary, " +
			"proxies and caches the weather services the app reads (unless STATIC is set), and serves " +
			"the bundled music or the tracks in --music-dir. Settings come from flags, then the " +
			"environment, then ./.env.",
		Example: "  ws4kp\n  WS4KP_PORT=9000 ws4kp --log-format text\n  go run ./cmd/ws4kp --dev --log-format text",
		Version: version,
		Args:    noArgs,
		// a runtime error is not a usage error; run prints errors itself
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			logger, err := newLogger(cmd)
			if err != nil {
				return err
			}
			cfg, err := config.Load(cmd.Flags(), logger)
			if err == nil {
				err = serve(cmd.Context(), cfg, logger)
			}
			if err != nil {
				logger.Error("ws4kp stopped", "error", err)
				return loggedError{err}
			}
			return nil
		},
	}
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return usageError{err} })
	cmd.PersistentFlags().String("log-format", "json", "log format: json or text")
	cmd.PersistentFlags().String("log-level", "info", "log level: debug, info, warn or error")
	config.RegisterFlags(cmd.Flags())
	cmd.AddCommand(newHealthcheckCmd())
	return cmd
}

func newHealthcheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "healthcheck",
		Short: "Exit 0 if the server on this host answers /manifest.json",
		Long: "healthcheck GETs http://127.0.0.1:<port>/manifest.json and exits 0 on a 2xx answer " +
			"within 4 seconds, 1 otherwise. The port comes from its own --port, else WS4KP_PORT, else " +
			"./.env, else 8080: it does not see the flags the serving process was started with, so a " +
			"server on another port should be configured through WS4KP_PORT. The container image's " +
			"HEALTHCHECK runs it.",
		Example: "  ws4kp healthcheck\n  ws4kp healthcheck --port 9000",
		Args:    noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load(cmd.Flags(), slog.New(slog.DiscardHandler))
			if err != nil {
				return err
			}
			return server.Healthcheck(cmd.Context(), fmt.Sprintf("http://127.0.0.1:%d/manifest.json", cfg.Port))
		},
	}
	config.RegisterFlags(cmd.Flags())
	return cmd
}

func newLogger(cmd *cobra.Command) (*slog.Logger, error) {
	format, err := cmd.Flags().GetString("log-format")
	if err != nil {
		return nil, err
	}
	levelName, err := cmd.Flags().GetString("log-level")
	if err != nil {
		return nil, err
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelName)); err != nil {
		return nil, usageError{fmt.Errorf("--log-level %q: want debug, info, warn or error", levelName)}
	}
	opts := &slog.HandlerOptions{Level: level}
	switch format {
	case "json":
		return slog.New(slog.NewJSONHandler(cmd.OutOrStdout(), opts)), nil
	case "text":
		return slog.New(slog.NewTextHandler(cmd.OutOrStdout(), opts)), nil
	default:
		return nil, usageError{fmt.Errorf("--log-format %q: want json or text", format)}
	}
}

// serve runs the server until SIGINT or SIGTERM (or ctx ends), then drains.
func serve(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	dist, err := fs.Sub(web.Files, "dist")
	if err != nil {
		return fmt.Errorf("embedded dist: %w", err)
	}
	scripts, err := fs.Sub(web.Files, "server/scripts")
	if err != nil {
		return fmt.Errorf("embedded scripts: %w", err)
	}
	srv, err := server.New(cfg, server.Assets{Dist: dist, Scripts: scripts}, logger)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	context.AfterFunc(ctx, stop) // restore default handling: a second signal ends a stuck drain
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", fmt.Sprintf(":%d", cfg.Port))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	logger.Info("listening", "addr", ln.Addr().String(), "version", version, "dev", cfg.Dev, "static", cfg.Static)
	if err := srv.Run(ctx, ln); err != nil {
		return err
	}
	logger.Info("stopped")
	return nil
}
