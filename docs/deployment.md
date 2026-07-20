# Deployment

WeatherStar 4000+ runs as a **server deployment** by default (Node/Express + a caching proxy). A legacy **static deployment** (nginx, everything in the browser) is kept for reference under [`.archive/static/`](../.archive/static/).

- [Run modes](#run-modes)
- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [Serving as a static app](#serving-as-a-static-app)
- [Default parameters via environment variables (`WSQS_`)](#default-parameters-via-environment-variables)

## Run modes

All modes serve at `http://localhost:8080/`.

| Command | JS | Caching proxy | Notes |
|---|---|---|---|
| `npm start` | individual module files | ✅ | Development: easiest debugging, source maps, live file watching; slower first load |
| `DIST=1 npm start` | minified/concatenated bundles | ✅ | Production: faster load; requires `npm run build` first |
| `STATIC=1 npm start` | individual module files | ❌ | Development without the proxy (browser calls the weather APIs directly) |
| `STATIC=1 DIST=1 npm start` | minified bundles | ❌ | Simulates the static Docker deployment |

**Server vs. static:**

- **Server** (default): the Node process calls the weather APIs through an in-process cache (request de-duplication, ETag/`max-age` handling, observability). Many viewers collapse into few upstream calls — best for a shared/kiosk/household deployment.
- **Static**: every browser calls the weather services directly. No shared caching, but the smallest, most robust footprint (any static host or CDN works). Archived; see below.

## Docker

The default `Dockerfile` builds the **server** image:

```bash
docker build -t ws4kp .
docker run -p 8080:8080 ws4kp
```

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
npm run build
```

Upload the resulting `dist/` folder anywhere. No server-side scripting is required.

**Node in static mode:**

```bash
STATIC=1 npm start          # serve development files without the proxy
STATIC=1 DIST=1 npm start   # serve the built (minified) files without the proxy
```

**Archived static Docker image:** see [`.archive/static/`](../.archive/static/).

## Default parameters via environment variables

When running the Express server, environment variables can seed a default configuration. If a user opens the root page (`http://localhost:8080/`), the server appends a query string built from these variables — effectively a default [permalink](usage.md#permalinks).

- Variables may be set on the command line or via a `.env` file (parsed by [dotenv](https://github.com/motdotla/dotenv)).
- Prefix with `WSQS_` and use the same key/value pairs as a permalink, replacing each `-` (dash) with `_` (underscore).

For example, the permalink parameter `travel-checkbox=true` becomes:

```bash
WSQS_travel=true
```

Generate a [permalink](usage.md#permalinks) with the exact configuration you want, then translate its parameters into `WSQS_` variables.
