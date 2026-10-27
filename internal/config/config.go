// Package config resolves the server's settings once at startup: flags, then the process
// environment, then ./.env, then defaults. A misconfigured server never starts.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/spf13/pflag"
	"github.com/spf13/viper"

	"github.com/jacaudi/ws4kp/internal/express"
)

// DotEnvFile is read from the working directory before anything else.
const DotEnvFile = ".env"

// Config is the resolved configuration.
type Config struct {
	Port      int
	Static    bool // proxies, /playlist.json and DELETE /cache are off
	Dev       bool // serve web/ from disk instead of the embedded build
	WebDir    string
	MusicDir  string
	CustomDir string
	// Query is every WSQS_* variable as a query parameter, in environment order:
	// WSQS_foo_bar=1 becomes foo-bar=1.
	Query []express.Param
	// Overrides is every OVERRIDE_* variable with the prefix removed.
	Overrides map[string]string
}

// settings is what Viper decodes; Viper lowercases every key.
type settings struct {
	Port      string `mapstructure:"port"` // parsed by parsePort, not by Viper
	Static    string `mapstructure:"static"`
	Dev       bool   `mapstructure:"dev"`
	WebDir    string `mapstructure:"webdir"`
	MusicDir  string `mapstructure:"musicdir"`
	CustomDir string `mapstructure:"customdir"`
}

type binding struct {
	key, env, flag string
	def            any
}

// portBinding is the one setting the healthcheck resolves. The port is bound as a string
// and parsed by parsePort: Viper's and pflag's integer decoding is base 0, so "010" would
// bind port 8 and "08080" would fail, where Node's Number() read both as decimal.
var portBinding = binding{"port", "WS4KP_PORT", "port", defaultPort}

const defaultPort = "8080"

// bindings is the single list of settings: Viper key, environment variable, flag and
// default. musicDir and customDir default to "" here and are resolved by Load, because
// their real defaults depend on dev.
var bindings = []binding{
	portBinding,
	{"static", "STATIC", "", ""},
	{"dev", "WS4KP_DEV", "dev", false},
	{"webdir", "WS4KP_WEB_DIR", "web-dir", "web"},
	{"musicdir", "WS4KP_MUSIC_DIR", "music-dir", ""},
	{"customdir", "WS4KP_CUSTOM_DIR", "custom-dir", ""},
}

// RegisterPortFlag adds --port to flags. It is a string flag; see portBinding.
func RegisterPortFlag(flags *pflag.FlagSet) {
	flags.String("port", defaultPort, "port to listen on (env WS4KP_PORT)")
}

// RegisterFlags adds the serve flags to flags.
func RegisterFlags(flags *pflag.FlagSet) {
	RegisterPortFlag(flags)
	flags.Bool("dev", false, "serve web/ from disk for local development (env WS4KP_DEV)")
	flags.String("web-dir", "web", "the web/ directory dev mode serves (env WS4KP_WEB_DIR)")
	flags.String("music-dir", "", "music folder that overrides the bundled tracks; default /app/server/music, or <web-dir>/server/music with --dev (env WS4KP_MUSIC_DIR)")
	flags.String("custom-dir", "", "folder holding custom*.* scripts; default /app/server/scripts, or <web-dir>/server/scripts with --dev (env WS4KP_CUSTOM_DIR)")
}

var wsqsKey = regexp.MustCompile(`^WSQS_[A-Za-z0-9_]+$`)

// Load reads ./.env into the environment (variables already set win), then resolves every
// setting with precedence flag > environment > default, and validates the result.
func Load(flags *pflag.FlagSet, logger *slog.Logger) (Config, error) {
	if err := loadDotEnv(DotEnvFile, logger); err != nil {
		return Config{}, err
	}

	v, err := newViper(flags, bindings)
	if err != nil {
		return Config{}, err
	}
	var s settings
	if err := v.Unmarshal(&s); err != nil {
		return Config{}, fmt.Errorf("decode config (WS4KP_DEV must be a boolean): %w", err)
	}
	port, portErr := parsePort(s.Port)

	if _, set := os.LookupEnv("DIST"); set {
		logger.Warn("DIST is ignored; the binary always serves the embedded build")
	}

	cfg := Config{
		Port:      port,
		Static:    s.Static != "", // any non-empty STATIC, as the Node server's !process.env.STATIC
		Dev:       s.Dev,
		WebDir:    s.WebDir,
		MusicDir:  s.MusicDir,
		CustomDir: s.CustomDir,
		Overrides: map[string]string{},
	}
	if cfg.MusicDir == "" {
		cfg.MusicDir = "/app/server/music"
		if cfg.Dev {
			cfg.MusicDir = filepath.Join(cfg.WebDir, "server", "music")
		}
	}
	if cfg.CustomDir == "" {
		cfg.CustomDir = "/app/server/scripts"
		if cfg.Dev {
			cfg.CustomDir = filepath.Join(cfg.WebDir, "server", "scripts")
		}
	}
	for _, kv := range os.Environ() {
		key, value, _ := strings.Cut(kv, "=")
		// Node read the environment as UTF-8, so an invalid byte arrived as U+FFFD.
		value = strings.ToValidUTF8(value, string(utf8.RuneError))
		if wsqsKey.MatchString(key) {
			name := strings.ReplaceAll(strings.TrimPrefix(key, "WSQS_"), "_", "-")
			cfg.Query = append(cfg.Query, express.Param{Key: name, Values: []string{value}})
		}
		if name, ok := strings.CutPrefix(key, "OVERRIDE_"); ok {
			cfg.Overrides[name] = value
		}
	}
	return cfg, errors.Join(portErr, cfg.validate())
}

// ResolvePort resolves only the port, with Load's precedence (flag, environment, ./.env,
// default). The healthcheck uses it so that settings it does not read, such as WS4KP_DEV
// without a web/ directory, cannot make it fail.
func ResolvePort(flags *pflag.FlagSet, logger *slog.Logger) (int, error) {
	if err := loadDotEnv(DotEnvFile, logger); err != nil {
		return 0, err
	}
	v, err := newViper(flags, []binding{portBinding})
	if err != nil {
		return 0, err
	}
	return parsePort(v.GetString(portBinding.key))
}

// newViper binds each of bs to its default, environment variable and flag.
func newViper(flags *pflag.FlagSet, bs []binding) (*viper.Viper, error) {
	v := viper.NewWithOptions(viper.ExperimentalBindStruct())
	for _, b := range bs {
		v.SetDefault(b.key, b.def)
		if err := v.BindEnv(b.key, b.env); err != nil {
			return nil, fmt.Errorf("bind %s: %w", b.env, err)
		}
		if b.flag == "" {
			continue
		}
		if err := v.BindPFlag(b.key, flags.Lookup(b.flag)); err != nil {
			return nil, fmt.Errorf("bind --%s: %w", b.flag, err)
		}
	}
	return v, nil
}

// parsePort reads s as a decimal integer in 1-65535, ignoring surrounding whitespace, as
// Node's Number() did: "010" is 10, "0x1F90" and "1_000" are errors.
func parsePort(s string) (int, error) {
	s = strings.TrimSpace(s)
	n, err := strconv.ParseInt(s, 10, 0)
	if err != nil || n < 1 || n > 65535 {
		return 0, fmt.Errorf("port %s (WS4KP_PORT or --port): must be a decimal integer between 1 and 65535", s)
	}
	return int(n), nil
}

func (c Config) validate() error {
	if c.Dev {
		if info, err := os.Stat(c.WebDir); err != nil || !info.IsDir() {
			return fmt.Errorf("web dir %q (WS4KP_WEB_DIR or --web-dir): dev mode needs the web/ directory; run from the repo root or pass --web-dir", c.WebDir)
		}
	}
	return nil
}

// loadDotEnv sets each variable in path that the environment does not already have, as
// dotenv's config() does. A missing file is not an error; a file that cannot be read is
// ignored with a warning, as dotenv carried on without it.
func loadDotEnv(path string, logger *slog.Logger) error {
	data, err := os.ReadFile(path) //nolint:gosec // the fixed name ./.env, as dotenv reads it
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		logger.Warn("cannot read .env; ignoring it", "file", path, "error", err)
		return nil
	}
	// In file order, so the environment, and with it the WSQS_ query, keeps that order.
	for _, v := range parseDotenv(strings.ToValidUTF8(string(data), string(utf8.RuneError))) {
		if _, set := os.LookupEnv(v.Key); set {
			continue
		}
		if err := os.Setenv(v.Key, v.Value); err != nil {
			return fmt.Errorf("set %s from %s: %w", v.Key, path, err)
		}
	}
	return nil
}
