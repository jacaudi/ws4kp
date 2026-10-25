# Music

The WeatherStar had wonderful smooth-jazz / new-age background music. The originals are copyrighted, so this project ships **AI-generated, WeatherStar-inspired tracks** from [ws4kp-music](https://github.com/netbymatt/ws4kp-music) instead. They are not all under the same license; see [licensing](#licensing). Looking for the originals? [TWCClassics](https://twcclassics.com/audio/) documents the historical playlists.

- [What ships in this fork](#what-ships-in-this-fork)
- [Licensing](#licensing)
- [Adding or overriding music](#adding-or-overriding-music)
- [Static hosting](#static-hosting)
- [Autoplay behavior](#autoplay-behavior)

## What ships in this fork

Two of the three [ws4kp-music](https://github.com/netbymatt/ws4kp-music) albums, 23 tracks in all, are bundled in `server/music/default/` and **baked into the container image**, so music plays out of the box.

| Album | Tracks | Bundled |
|---|---|---|
| Current Conditions | 10 | yes: the original 192 kbps release that shipped with ws4kp (ws4kp-music now holds 128 kbps re-encodes of it) |
| Latest Observations | 13 | yes: copied from ws4kp-music commit [`8e3ecf6`](https://github.com/netbymatt/ws4kp-music/tree/8e3ecf67dd1f752c651780d239e94704e922c970) |
| Holiday | 10 | no: there is no seasonal scheduling, so it would play year-round. Add its files to `server/music/` to use it. |

The bundled tracks are named `<album>--<song>.mp3`, all lower case, with each space a single dash: `current-conditions--rolling-clouds.mp3`, `latest-observations--rolling-clouds.mp3`. The album prefix keeps the two albums' *Rolling Clouds* apart. The player shows each track's own title and artist tags, not its file name.

To keep the git repository lean, the `.mp3` files are stored with **[Git LFS](https://git-lfs.com/)** (see `.gitattributes`) — the audio lives in LFS storage, not the git blob history. CI checks out with `lfs: true` so the real files (not pointer files) end up in the image.

> Cloning locally? Install Git LFS (`git lfs install`) so the tracks download as real audio. Without it you'll get small pointer files.

## Licensing

| Album | License | Commercial use (e.g. a monetized stream) |
|---|---|---|
| Latest Observations | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | allowed, with attribution |
| Current Conditions | owned by Suno, non-commercial only | not allowed |
| Holiday (not bundled) | owned by Suno, non-commercial only | not allowed |

Attribution for the Latest Observations tracks: *Music from [ws4kp-music](https://github.com/netbymatt/ws4kp-music) by netbymatt, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).*

For commercial use, play only the Latest Observations tracks: mount a folder containing just those over `server/music` (see below).

## Adding or overriding music

The server generates `playlist.json` by scanning `./server/music` for `.mp3` files; if none are found it falls back to `./server/music/default/`. The playlist is served at `/playlist.json`, and the browser randomizes track order (reshuffling each loop). Subdirectories are not scanned.

**Add your own tracks:** drop `.mp3` files into `./server/music/`.

**Override the bundled music in Docker** — bind-mount a folder over the music directory:

```bash
docker run -p 8080:8080 -v /path/to/your/music:/app/server/music ws4kp
```

Because the scanner uses `./server/music` first and only falls back to `default/`, a non-empty mount replaces the bundled tracks.

## Static hosting

When hosting the built static files (no server):

- **Archived static Docker image:** the build creates `playlist.json` but the image intentionally removes it, forcing browser-side directory scanning. The browser requests `playlist.json`, gets a `404` carrying the `X-Weatherstar` header, and falls back to scanning `music/`.
- **Manual static hosting:** if you build and upload the files yourself (`npm run build`), `playlist.json` contains the default tracks unless you customize `./server/music/` before building.

For browser directory scanning to work, the web server must generate directory listings for `music/` **and** send the `X-Weatherstar: true` header (the archived nginx config does both). To add music in the archived static image, bind-mount to `/usr/share/nginx/html/music`.

## Autoplay behavior

WeatherStar is muted by default. If it was unmuted on your last visit it will try to auto-play on the next — but browsers deliberately restrict autoplay (rightly so). See [Chrome](https://developer.chrome.com/blog/autoplay/#media_engagement_index) and [Firefox](https://hacks.mozilla.org/2019/02/firefox-66-to-block-automatically-playing-audible-video-and-audio/) for the rules.

Chrome is more lenient over time and honors a launch flag, which is ideal for kiosk setups:

```
chrome.exe --autoplay-policy=no-user-gesture-required
```

If you can't pre-set the play state before entering kiosk mode (e.g. a home dashboard), pass these query-string values — the browser still enforces its autoplay rules:

```
?mediaPlaying=true
?mediaVolume=0.75   # 0–1.0 as a percent
```
