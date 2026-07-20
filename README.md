![WeatherStar 4000+ Current Conditions](server/images/social/1200x600.png)

# WeatherStar 4000+

A modern, browser-based recreation of The Weather Channel's early-90s **WeatherStar 4000** local forecast — the blue-and-orange graphics, the smooth-jazz music, the endless scroll of your regional weather — driven by the live [NOAA/NWS API](https://www.weather.gov/documentation/services-web-api).

This is an enhanced fork of [netbymatt/ws4kp](https://github.com/netbymatt/ws4kp) (see the original live at [weatherstar.netbymatt.com](https://weatherstar.netbymatt.com)). It adds an **Air Quality** display, a reworked **user-centered Regional Forecast**, a **server-first container deployment**, and bundled **music baked into the image**. See [What's added in this fork](#whats-added-in-this-fork).

---

## What it is

The goal is the *feel* of the 90s: a simple, low-fuss weather app that looks and sounds like The Weather Channel did back then, using data that's available today. It is **not** a hardware-accurate emulator — for that, see the [WS4000 Simulator](http://www.taiganet.com/). Some screens differ from the original because more (or less) forecast data is available now than in the 90s.

Because the data comes from NOAA, WeatherStar 4000+ works for **US locations only**. For international weather, see the [`ws4kp-international`](https://github.com/mwood77/ws4kp-international) fork by [@mwood77](https://github.com/mwood77).

## What it does

A rotating set of forecast "displays," most toggle-able on the page:

- **Current Conditions** and **Latest Observations**
- **Local Forecast** and **Extended Forecast** (several days)
- **Hourly Graph** (temperature, clouds, precip for the next 36 h) and an **Hourly Forecast**
- **Regional Forecast** map — user-centered, denser city selection *(reworked in this fork)*
- **Air Quality** *(new in this fork; key-free [Open-Meteo](https://open-meteo.com/) data)*
- **Travel Cities**, **Almanac**, **Radar**, **Hazards**, and the **SPC Severe-Weather Outlook**
- Retro **background music**, scan-line CRT effect, kiosk mode, and shareable permalinks

## Data sources

All weather data comes from free, public services (the server proxies and caches them; in static mode the browser calls them directly):

| Source | Used for |
|---|---|
| **[NOAA / National Weather Service API](https://www.weather.gov/documentation/services-web-api)** — `api.weather.gov`, `forecast.weather.gov` | Forecasts, current conditions, observations, and hazards/alerts |
| **[NWS Radar](https://radar.weather.gov/)** + **[Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/)** — `radar.weather.gov`, `mesonet.agron.iastate.edu` | Radar imagery (Mesonet is the default tile source; override with `RADAR_HOST`) |
| **[NOAA Storm Prediction Center](https://www.spc.noaa.gov/)** — `www.spc.noaa.gov` | The severe-weather (SPC) outlook |
| **[Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)** — `air-quality-api.open-meteo.com` | US AQI for the **Air Quality** display *(added in [#7](https://github.com/jacaudi/ws4kp/pull/7))* — key-free |

Because NOAA's API is US-only, so is WeatherStar 4000+.

## Quick start

Requires [Node.js](https://nodejs.org/) (v24+ recommended).

```bash
git clone https://github.com/jacaudi/ws4kp.git
cd ws4kp
npm install
npm start
```

Then open **http://localhost:8080/** and search for a US location.

## Running it

WeatherStar 4000+ runs as a **server deployment** by default: a small Node/Express server with a caching proxy in front of the weather APIs (request de-duplication + caching, so many viewers make few upstream calls).

**Run modes** — all serve at `http://localhost:8080/`:

| Command | Mode | Caching proxy |
|---|---|---|
| `npm start` | development — individual modules, easiest debugging | ✅ |
| `DIST=1 npm start` | production — minified bundles (run `npm run build` first) | ✅ |
| `STATIC=1 npm start` | development, browser calls the weather APIs directly | ❌ |
| `STATIC=1 DIST=1 npm start` | simulates the static deployment | ❌ |

**With Docker** — the default image is the server build:

```bash
docker build -t ws4kp .
docker run -p 8080:8080 ws4kp
```

Or pull a prebuilt multi-arch image (amd64 + arm64) — `:latest` from `main`, `:vX.Y.Z` for releases, `:sha-<short>` for any build:

```bash
docker run -p 8080:8080 ghcr.io/jacaudi/ws4kp:latest
```

**With Docker Compose:**

```yaml
services:
  ws4kp:
    build: .            # or image: ghcr.io/jacaudi/ws4kp:latest
    ports:
      - 8080:8080
    restart: unless-stopped
    environment:
      # Any permalink parameter can seed a default via WSQS_ (see docs/deployment.md)
      - WSQS_latLonQuery=Orlando International Airport Orlando FL USA
```

Development vs. production modes, the archived static (nginx) deployment, and the full `WSQS_` environment-variable reference live in **[docs/deployment.md](docs/deployment.md)**.

## Configuration

Seed a default location and display set with `WSQS_` environment variables — handy for kiosks and dashboards. Any [permalink](#using-it) parameter works: replace each `-` with `_` and prefix it with `WSQS_`.

```bash
docker run -p 8080:8080 \
  -e WSQS_latLonQuery="Orlando International Airport Orlando FL USA" \
  -e WSQS_kiosk=true \
  ghcr.io/jacaudi/ws4kp:latest
```

Variables can also come from a `.env` file. The full reference is in [docs/deployment.md](docs/deployment.md#default-parameters-via-environment-variables).

## Using it

- **Access:** open `http://localhost:8080/`, search a location, and pick the displays you want with the checkboxes.
- **Permalinks:** click *Copy Permalink* to capture your exact configuration and location as a shareable/bookmarkable URL. You can also hand-build one — omitted settings fall back to defaults:
  ```
  http://localhost:8080/?latLonQuery=Orlando+International+Airport&units-select=metric&kiosk=true
  ```
- **Kiosk mode:** a full-screen, controls-hidden view for dashboards and signage — toggle it on the page, or append `&kiosk=true` to a permalink. Great as an installed PWA / iOS Home-Screen app. Exit with **Ctrl-K** or by reloading.

**Settings at a glance:**

| Setting | What it does |
|---|---|
| **Speed** | Playback speed, "Very Fast" (1.5×) → "Very Slow" (0.5×) |
| **Display Mode** | Standard (4:3), Widescreen (16:9), Widescreen Enhanced, Portrait Enhanced |
| **Kiosk / Sticky Kiosk** | Full-screen view now / persisted across visits (for Home-Screen apps) |
| **Scan Lines** | Retro CRT scan-line effect |
| **Units** | US ↔ metric (some NWS text products keep embedded units) |
| **Volume** | Audio level when music is enabled |

Full details on permalinks, kiosk/PWA install, every setting, and custom scrolling text are in **[docs/usage.md](docs/usage.md)**.

## Music

The build ships with a set of copyright-free, WeatherStar-inspired tracks (stored via **Git LFS** and **baked into the container image**), so music plays out of the box. Drop your own `.mp3` files in `./server/music/` — or bind-mount a folder over `/app/server/music` in Docker — to override them.

Adding/replacing music, the autoplay rules browsers enforce, and static-mode scanning are covered in **[docs/music.md](docs/music.md)**.

## What's added in this fork

Beyond the upstream project, this fork adds:

- **Air Quality display** — key-free Open-Meteo AQI, works in both server and static modes.
- **User-centered Regional Forecast** — nearest-N ranked city selection with a junk filter and label-collision handling, plus AK/HI projection fixes.
- **Server-first deployment** — the caching server image is the default; the static nginx build is archived under [`.archive/static/`](.archive/static/).
- **Bundled music via Git LFS**, and **automated releases** (release-please → SemVer tags, changelog, and `vX.Y.Z` container images).

## Project layout

| Path | What's there |
|---|---|
| `index.mjs` | Express server entry — routes, the caching proxy, and `WSQS_` env-var seeding |
| `server/scripts/modules/` | The browser app: one module per display, orchestrated by `navigation.mjs` over a `WeatherDisplay` base class |
| `server/styles/scss/` | SCSS sources (compiled to CSS by the build) |
| `server/music/default/` | Bundled music (Git LFS) baked into the image |
| `datagenerators/` | Build-time scripts and their baked JSON (weather stations, regional cities) |
| `proxy/` | The server-mode caching proxy |
| `.archive/static/` | The archived static (nginx) deployment |
| `docs/` | The guides linked below |

---

## Documentation

In-depth guides live in [`docs/`](docs/):

| Guide | What's inside |
|---|---|
| **[Deployment](docs/deployment.md)** | Server vs. static, dev/prod modes, Docker & Compose, archived nginx image, `WSQS_` environment variables |
| **[Usage & settings](docs/usage.md)** | Permalinks, kiosk mode, iOS/Android PWA install, every setting, custom scrolling text |
| **[Music](docs/music.md)** | Bundled tracks (Git LFS), adding/overriding music, autoplay behavior, static-mode scanning |
| **[Development & customization](docs/development.md)** | Tech stack, build system, the `custom.js` hook, contributing |
| **[FAQ & community](docs/faq.md)** | Outside-the-USA, the full-moon icon, phone apps, reporting issues, related & community projects |

---

## Acknowledgements

- **[Matt (netbymatt)](https://github.com/netbymatt)** — the maintainer of
  [ws4kp](https://github.com/netbymatt/ws4kp), which this project is forked from. Nearly all of
  WeatherStar 4000+ — the displays, the data plumbing, the look and feel — is his work and is kept
  largely intact here; this fork only adds a few displays and a container/release setup on top.
  Thank you for building it, keeping it open, and maintaining it!
- **[Mike Battaglia (vbguyny)](https://github.com/vbguyny/ws4kp)** — the creator of the original
  WeatherStar 4000 web project (which Matt forked in 2020) and the code that draws the weather
  displays and the background maps. Thank you for the foundation the whole project rests on!
- **The team at [TWCClassics](https://twcclassics.com/)** — for the WeatherStar 4000
  [fonts](https://twcclassics.com/downloads.html) and [icon sets](https://twcclassics.com/downloads.html)
  and for meticulously documenting the original hardware. Icons by Charles Abel, Nick Smith, and
  Malek Masoud; fonts originally by Nick Smith. Thank you for preserving the look of the era!
- **The ws4kp community** — for the contributions, forks, and write-ups linked in
  [docs/faq.md](docs/faq.md). Thank you for keeping retro forecasts alive!

## Disclaimer

This site should **NOT** be used in life-threatening weather situations, or be relied on to inform the public of such situations. The Internet is an unreliable network subject to outages and is not suitable for mission-critical use. If you require reliable access to NWS data, please consider one of their subscription services. The authors shall not be held liable for injury, death, or property damage resulting from disregarding this warning.

The WeatherSTAR 4000 unit and technology is owned by The Weather Channel. This is a free, non-profit work by fans; all background graphics were created from scratch.
