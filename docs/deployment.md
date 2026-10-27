# Deployment

WeatherStar 4000+ runs as a **server deployment** by default: one Go binary that serves the browser app built into it, plus a caching proxy in front of the weather services. A legacy **static deployment** (nginx, everything in the browser) is kept for reference under [`.archive/static/`](../.archive/static/).

- [Run modes](#run-modes)
- [Configuration](#configuration)
- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [Serving as a static app](#serving-as-a-static-app)
- [Default parameters via environment variables (`WSQS_`)](#default-parameters-via-environment-variables)
- [Upgrading from v7 (the Node server)](#upgrading-from-v7-the-node-server)

## Run modes

Run these from the repo root. All modes serve at `http://localhost:8080/`.

| Command | JS | Caching proxy | Notes |
|---|---|---|---|
| `task dev` | individual module files, from `web/server/` on disk | ✅ | Development: rebuilds the dev index and the CSS on change; reload the page to see an edit |
| `npm --prefix web run build && go run ./cmd/ws4kp` | minified bundles, built into the binary | ✅ | Production, as the image runs it. The binary embeds `web/dist/` when it is compiled, so rebuild after `npm run build` |
| `STATIC=1 task dev` | individual module files | ❌ | Development without the proxy (the browser calls the weather APIs directly) |
| `STATIC=1 go run ./cmd/ws4kp` | minified bundles | ❌ | Simulates the static deployment |

`task dev` needs [Task](https://taskfile.dev), Go 1.27.3 or later, and Node 24 (`npm ci` in `web/` first). It runs `go run ./cmd/ws4kp --dev` next to `npm --prefix web run dev:watch`; Ctrl-C stops both.

**Server vs. static:**

- **Server** (default): the Go binary calls the weather APIs through an in-process cache (request de-duplication, ETag/`max-age` handling, a stale copy when upstream fails). Many viewers collapse into few upstream calls — best for a shared/kiosk/household deployment.
- **Static**: every browser calls the weather services directly. No shared caching, but the smallest, most robust footprint (any static host or CDN works). Archived; see below.

## Configuration

Precedence is flag, then environment variable, then `.env`, then the default.

| Setting | Environment | Flag | Default |
|---|---|---|---|
| Port | `WS4KP_PORT` | `--port` | `8080` |
| Static mode (no proxy, no `/playlist.json`) | `STATIC` (any non-empty value) | — | off |
| Dev mode (serve `web/` from disk) | `WS4KP_DEV` | `--dev` | off |
| The `web/` directory dev mode serves | `WS4KP_WEB_DIR` | `--web-dir` | `web` |
| Music folder | `WS4KP_MUSIC_DIR` | `--music-dir` | `/app/server/music`; `web/server/music` with `--dev` |
| Folder holding `custom*.*` scripts | `WS4KP_CUSTOM_DIR` | `--custom-dir` | `/app/server/scripts`; `web/server/scripts` with `--dev` |
| Log format | — | `--log-format` | `json` (`text` for humans) |
| Log level | — | `--log-level` | `info` (`debug` shows every cache hit) |

`WSQS_*` and `OVERRIDE_*` variables are read as well (see below). `DIST` is accepted and ignored, with one warning: the binary always serves its embedded build.

**Two `.env` files, two jobs:**

- **`.env` in the server's working directory** (the repo root under `task dev` and `go run`): read by the binary at startup with dotenv's rules (`KEY=value`, optional `export `, `#` comments, quotes stripped, no `$VAR` expansion; other lines are skipped). A variable already set in the environment wins over the file, and a `.env` the server cannot read is skipped with a warning.
- **`web/.env`**: read by `npm run build` (gulp), which bakes `OVERRIDE_*` values into the static build in `web/dist/`. The server replaces those with its own `OVERRIDE_*` values on every page, so this file only matters for static hosting.

## Docker

The default `Dockerfile` builds the **server** image: the site is built with Node, the Go binary embeds it, and the runtime image is `gcr.io/distroless/static-debian13:nonroot` holding that one binary.

```bash
docker build -t ws4kp .
docker run -p 8080:8080 ws4kp
```

- The container runs as uid **65532** (`nonroot`), with no shell and no package manager.
- Mounted files must be **world-readable**: `/app/server/music` (your tracks), `/app/server/scripts/custom.js`, `custom.mjs` or `custom-config.json`, and a mounted `/app/.env`. A file the server cannot read is skipped with a warning in the log.
- Files served from a mount keep their `Last-Modified` and carry no `ETag`; files built into the binary carry a strong `ETag` and no `Last-Modified`.
- The image's `HEALTHCHECK` runs `/app/ws4kp healthcheck`, which requests `/manifest.json` on the port from `WS4KP_PORT` (or `.env`, else 8080). It does not see flags given to the server, so set a different port through the environment: `docker run -p 9000:9000 -e WS4KP_PORT=9000 ws4kp`. The same command works from outside: `docker exec <container> /app/ws4kp healthcheck`.
- Arguments after the image name are flags, for example `docker run -p 8080:8080 ws4kp --log-format text`. Logs are JSON lines on stdout by default.
- Set `GOMEMLIMIT` to about 85% of the container's memory limit (for example `GOMEMLIMIT=435MiB` under a 512 MiB limit), so the Go runtime frees memory before the kernel kills the container.

Prebuilt multi-arch images (linux/amd64 + linux/arm64) are published to `ghcr.io/jacaudi/ws4kp`:

- `:latest` — built from `main`
- `:vX.Y.Z`, `:X.Y`, `:X` — built from release tags
- `:sha-<short>` — every build (branches included)

The legacy **static (nginx)** image is archived under [`.archive/static/`](../.archive/static/) (build it with the repo root as the context):

```bash
docker build -f .archive/static/Dockerfile -t ws4kp-static .
docker run -p 8080:8080 ws4kp-static
```

## Docker Compose

```yaml
services:
  ws4kp:
    build: .            # or: image: ghcr.io/jacaudi/ws4kp:latest
    container_name: ws4kp
    ports:
      - 8080:8080       # change the host port to suit your network
    restart: unless-stopped
    environment:
      # Any permalink argument can seed a default via WSQS_ (see below)
      - WSQS_latLonQuery=Orlando International Airport Orlando FL USA
      - WSQS_hazards=false
      - WSQS_current_weather=true
```

## Serving as a static app

If you just want static hosting, you don't need a Dockerfile at all:

**Any web server (Apache, nginx, a CDN, object storage):**

```bash
cd web
npm run build
```

Upload the resulting `web/dist/` folder anywhere. No server-side scripting is required.

**The Go server in static mode:**

```bash
STATIC=1 task dev                                         # development files, no proxy
npm --prefix web run build && STATIC=1 go run ./cmd/ws4kp # the built (minified) files, no proxy
```

**Archived static Docker image:** see [`.archive/static/`](../.archive/static/).

## Default parameters via environment variables

Environment variables can seed a default configuration. If a user opens the root page (`http://localhost:8080/`) with no query string, the server redirects to a query string built from these variables — effectively a default [permalink](usage.md#permalinks).

- Variables may be set in the environment or in the server's `.env` file (see [Configuration](#configuration)).
- Prefix with `WSQS_` and use the same key/value pairs as a permalink, replacing each `-` (dash) with `_` (underscore).

For example, the permalink parameter `travel-checkbox=true` becomes:

```bash
WSQS_travel=true
```

Generate a [permalink](usage.md#permalinks) with the exact configuration you want, then translate its parameters into `WSQS_` variables.

## Upgrading from v7 (the Node server)

v8.0.0 replaced the Node/Express server with the Go binary. Environment variable names, port 8080 and the mount paths are unchanged. What changed:

- **The image runs as uid 65532.** Make mounted music, custom scripts and a mounted `.env` world-readable (`chmod -R a+rX /path/to/music`).
- **There is no shell, `node` or `npm` in the image.** Replace any `command:`/`entrypoint:` override that ran `npm start` or `node`: the entrypoint is `/app/ws4kp`, and arguments are its flags. A `HEALTHCHECK` or probe that ran `wget` should use `/app/ws4kp healthcheck`, or an HTTP probe on `/manifest.json`.
- **`DIST` does nothing** (one warning at startup): the binary always serves the embedded production build.
- **`DOTENV_*` options are no longer read.** DOTENV_* options (DOTENV_CONFIG_PATH, DOTENV_PATH, DOTENV_OVERRIDE, DOTENV_ENCODING, DOTENV_QUIET) are no longer read; the server reads ./.env in its working directory only.
- **The healthcheck reads the port from the environment.** If you serve on another port, set `WS4KP_PORT`; a `--port` flag is not seen by `ws4kp healthcheck`.
- **Logs are JSON lines on stdout** (`--log-format text` for human-readable lines), and routine cache activity logs only at `--log-level debug`.
- **Upstreams need TLS 1.3.** Every proxied service is reached over TLS 1.3 or not at all; all seven defaults support it. An `OVERRIDE_RADAR_HOST` mirror that only speaks TLS 1.2 stops working (the proxy answers 500).
- **Unknown paths get Go's plain-text `404 page not found`**, not Express's HTML "Cannot GET" page, and a method other than GET or HEAD gets 405.
- **Proxied query strings are re-encoded slightly differently:** parameters keep the order they were sent in (Node moved numeric-looking keys first), and a run of non-UTF-8 bytes becomes one U+FFFD rather than one per byte. Upstreams read the same parameters either way.
- **From a clone, `npm start` is gone.** Use `task dev` (or `go run ./cmd/ws4kp --dev`) from the repo root. The server's `.env` moves from `web/.env` to the repo root; `web/.env` is now read only by `npm run build`.
