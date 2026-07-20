# Usage & Settings

- [Permalinks](#permalinks)
- [Kiosk mode](#kiosk-mode)
- [Installing as an app (PWA / Home Screen)](#installing-as-an-app)
- [Settings reference](#settings-reference)
- [Custom scrolling text](#custom-scrolling-text)

## Permalinks

Your selected displays, forecast city, and widescreen setting are sticky from one session to the next. To share or bookmark an exact configuration, click **Copy Permalink** (or **Get Permalink**) near the bottom of the page — a URL with all your selections and location is copied to your clipboard.

Permalinks are long. Example for Orlando International Airport:

```
https://weatherstar.netbymatt.com/?hazards=false&current-weather=true&latest-observations=true&hourly=false&hourly-graph=true&travel=false&regional-forecast=true&local-forecast=true&extended-forecast=true&almanac=false&spc-outlook=true&radar=true&wide=false&kiosk=false&scanLines=false&speed-select=1.00&units-select=us&latLonQuery=Orlando+International+Airport%2C+Orlando%2C+FL%2C+USA&latLon=%7B%22lat%22%3A28.431%2C%22lon%22%3A-81.3076%7D
```

You can also build your own; omitted settings fall back to defaults:

```
https://weatherstar.netbymatt.com/?latLonQuery=Orlando+International+Airport
https://weatherstar.netbymatt.com/?kiosk=true
https://weatherstar.netbymatt.com/?units-select=metric
```

> Tip: permalink parameters map directly to the `WSQS_` environment variables used to seed server defaults — see [deployment.md](deployment.md#default-parameters-via-environment-variables).

## Kiosk mode

Kiosk mode is a full-screen-like view without the play/volume toolbar, scaled to fill the space. It does **not** use the browser's native fullscreen/kiosk mode (those can only be triggered by user interaction or by launching the browser with flags like `--start-fullscreen` / `--kiosk`).

- Toggle it with the **Kiosk** checkbox on the page. While active there's no on-screen way out — reload the page to leave (this is deliberate). A separate full-screen icon in the toolbar handles laptop/mobile fullscreen.
- Enter it via a permalink by appending `&kiosk=true`. The page loads your selected displays, enters kiosk mode, and starts playing.
- Exit at any time with **Ctrl-K**, or add `&kiosk=false` to the URL.

## Installing as an app

**iOS / iPadOS (Mobile Safari)** — use **Sticky Kiosk** to persist kiosk mode across launches (Safari doesn't support PWA installation via `manifest.json` or the Fullscreen API):

1. Tap **Share → Add to Home Screen**, name it, tap **Add**.
2. Launch the new Home-Screen shortcut.
3. Configure all settings exactly how you want them.
4. Enable **Sticky Kiosk**.
5. Tap **Kiosk**.

**Android / Desktop** — the included `manifest.json` enables PWA installation:

1. Configure your settings (ignore Kiosk / Sticky Kiosk for now).
2. Create a permalink and append `&kiosk=true`.
3. Open that URL, then use the browser's **Install** / **Add to Home Screen** prompt.
4. The installed PWA launches straight into kiosk mode (while the plain browser URL won't force kiosk).

**Notes / limitations:**

- iOS/iPadOS strips URL parameters when adding to Home Screen and runs shortcuts in isolated storage. After enabling kiosk on a Home-Screen app there, the only way to change settings is to delete and recreate the shortcut.
- Where you *can* edit a shortcut's URL, remove a sticky kiosk with `&kiosk=false` (or press **Ctrl-K** with a keyboard).

## Settings reference

| Setting | Description |
|---|---|
| **Speed** | Playback speed multiplier, from "Very Fast" (1.5×) to "Very Slow" (0.5×); "Normal" is 1×. |
| **Display Mode** | **Standard** (classic 4:3), **Widescreen** (16:9, no pillarboxing), **Widescreen Enhanced** (wider maps / more data), **Portrait Enhanced** (16:9 portrait, in progress). |
| **Kiosk** | Immediately enters kiosk mode (hides settings). Exit by refreshing or **Ctrl-K**. |
| **Sticky Kiosk** | Persists the kiosk preference in local storage so the page auto-enters kiosk on later visits (designed for iOS/iPad Home-Screen apps). |
| **Scan Lines** | Retro CRT scan-line effect. |
| **Scan Lines Style** | Override the automatic scan-line scale factor. |
| **Units** | Switch US ↔ metric. (Some NWS text products contain embedded units that are not converted.) |
| **Volume** | Audio level when music is enabled. |

## Custom scrolling text

To show custom text in the bottom blue scroll bar, enable **Enable RSS Feed/Text**, type your text in the box that appears, and press **Set**.

Separate multiple strings with a pipe (`|`) to have WeatherStar pick one at random on each pass through the current conditions:

```
Welcome to WeatherStar|Thanks for watching
```
