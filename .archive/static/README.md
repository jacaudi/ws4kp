# Archived: static (nginx) deployment

This folder holds the **legacy static deployment** of WeatherStar 4000+. It was the
default container image before the project standardized on the **server deployment**
(the caching Node/Express proxy — now the default `Dockerfile` in the repo root).

It's kept here for reference and for anyone who still wants a pure client-side build.
It is **not** built by CI.

## What it is

A pure client-side deployment: `npm run build` produces the static `dist/` bundle, and
**nginx** serves it. There is no server component — every browser calls the weather
services (NWS, Open-Meteo) **directly**.

Trade-offs vs. the server deployment:

- **No shared caching.** Each viewer makes its own upstream calls, so N viewers ≈ N×
  the upstream load. The server deployment's in-process proxy (`proxy/cache.mjs`)
  instead deduplicates in-flight requests and honors ETag/`max-age`, collapsing many
  viewers into few upstream calls.
- **Smallest footprint / most robust to operate** — just static files behind nginx,
  stateless, trivially scalable (any static host or CDN works too).
- **Client IPs hit the weather APIs directly** (no single egress point).

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `node:24-alpine` runs `npm run build`, then `nginx:alpine` serves `dist/`. |
| `nginx.conf` | nginx server block (port 8080, `.mjs` MIME type, SPA `try_files`, music autoindex). Installed to `/etc/nginx/conf.d/default.conf`. |
| `static-env-handler.sh` | nginx entrypoint (`/docker-entrypoint.d/01-…`) that turns `WSQS_*` environment variables into the default permalink query string at container start-up (the static analogue of what `index.mjs` does at request time in server mode). |

## Build & run

Paths below are relative to the **repo root** (the build context must be the repo root
so the Dockerfile can copy the whole project):

```bash
docker build -f .archive/static/Dockerfile -t ws4kp-static .
docker run -p 8080:8080 ws4kp-static
```

`WSQS_*` environment variables work the same as in the main README (e.g.
`-e WSQS_latLonQuery="Orlando International Airport Orlando FL USA"`); they are applied
by `static-env-handler.sh` on start-up.

## No Docker needed

If you just want static hosting, you don't need this Dockerfile at all — run
`npm run build` and upload the resulting `dist/` to any web server (Apache, nginx, a
CDN, object storage, etc.). No server-side scripting is required.
