# FAQ & Community

- [Does it work outside the USA?](#does-it-work-outside-the-usa)
- [The full-moon icon is broken](#the-full-moon-icon-is-broken)
- [Reporting issues & requesting features](#reporting-issues--requesting-features)
- [Phone apps](#phone-apps)
- [Related projects](#related-projects)
- [Community notes](#community-notes)

## Does it work outside the USA?

No. The project is tightly coupled to [NOAA's Weather API](https://www.weather.gov/documentation/services-web-api), which is US-only — and that's essential to an authentic WeatherStar 4000+ experience. For international locations, see the [`ws4kp-international`](https://github.com/mwood77/ws4kp-international) fork by [@mwood77](https://github.com/mwood77).

## The full-moon icon is broken

Known issue that appears as the WeatherStar ages — and it affected the [real WeatherStar hardware](https://youtu.be/rcUwlZ4pqh0?feature=shared&t=116) too.

## Reporting issues & requesting features

- **api.weather.gov outages aren't bugs here.** The API is not yet considered fully operational and can go down regionally (by NWS office). Chicago might fail while Dallas works fine.
- This is a best-effort recreation that fits within what the API and a web browser allow — not a perfect emulation of the WeatherStar 4000.
- **Units:** not everything converts to metric. Some text products (e.g. warnings) are plain strings from the NWS with baked-in units like "gusts up to 60 mph" that are left as-is.

## Phone apps

You can get an app-like experience on Android and iOS without a native app by using your browser's **Install** / **Add to Home Screen** feature — see [Installing as an app](usage.md#installing-as-an-app).

The upstream project has an Android app in closed beta (a thin wrapper around the website). There is no iOS native app.

## Related projects

- Not retro enough? Try [WeatherStar 3000+](https://github.com/netbymatt/ws3kp).
- International weather: [`ws4kp-international`](https://github.com/mwood77/ws4kp-international).

## Community notes

Extensions and write-ups from the WeatherStar+ community:

- [Stream as FFMPEG](https://github.com/netbymatt/ws4kp/issues/37#issuecomment-2008491948)
- [Weather like it's 1999](https://blog.scottlabs.io/2024/02/weather-like-its-1999/) — Raspberry Pi + streaming + music + CRT, a complete build
- [ws4channels](https://github.com/rice9797/ws4channels) — stream WeatherStar 4000 into Channels DVR (Node + Puppeteer + FFmpeg)
- [SSL certificates](https://github.com/netbymatt/ws4kp/issues/135) — hosting with HTTPS (enables geolocation)
- [Changing playlists](https://github.com/netbymatt/ws4kp/issues/138) — rotating the playlist on a schedule
- [Customize travel-forecast cities](https://github.com/netbymatt/ws4kp/issues/146#issuecomment-3363940202)

## Use of the live upstream site

Linking directly to the upstream live site at [weatherstar.netbymatt.com](https://weatherstar.netbymatt.com) is encouraged — including for digital signage, home dashboards, streaming, and public display. Please note the [disclaimer](../README.md#disclaimer).
