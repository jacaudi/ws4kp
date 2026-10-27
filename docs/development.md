# Development & Customization

- [Tech stack](#tech-stack)
- [Build & run](#build--run)
- [The custom script hook](#the-custom-script-hook)
- [Releases & CI](#releases--ci)

## Tech stack

The codebase is intentionally open, well-commented, and as library-free as possible so it's approachable to learn from. It exercises a lot of common web technology:

- The [api.weather.gov](https://www.weather.gov/documentation/services-web-api) REST API
- Modern ES: arrow functions, promises, `async`/`await` (parallel loading of all forecast resources), classes, and JavaScript modules
- A clear separation between API code and UI code
- [luxon](https://moment.github.io/luxon/) for date parsing
- Practical API-rate and static-asset caching
- Straightforward hand-written HTML
- A Gulp + Webpack build to bundle scripts
- A Go server (`cmd/ws4kp`, `internal/`) that embeds the built site and proxies and caches the weather APIs
- Hand-written CSS managed with SASS
- ESLint (airbnb-extended, flat config) for consistent style

The Go server's tests run from the repo root; unit tests for the newer pure-logic browser modules use Node's built-in test runner:

```bash
go vet ./... && go test -race ./...
cd web
npm run test:unit
npm run lint        # everything except tests/ (see web/eslint.config.mjs)
```

## Build & run

```bash
npm --prefix web ci
task dev                      # development: web/server/ from disk, caching proxy, rebuilds on change
npm --prefix web run build    # produce web/dist/
go run ./cmd/ws4kp            # production: the build embedded in the binary
```

`task dev` renders `views/index.ejs` to `web/.dev/index.html` and recompiles `ws.min.css` whenever their sources change, while the Go server serves `web/server/` from disk; reload the page to pick up an edit. The binary embeds `web/dist/` when it is compiled, so after `npm run build` restart `go run` to serve the new build.

See [deployment.md](deployment.md) for every run mode and the Docker builds.

## The custom script hook

`web/server/scripts/custom.js` lets you customize your own fork without pushing changes back upstream. A sample lives at `web/server/scripts/custom.sample.js` — copy it to `custom.js` to activate it.

`web/server/scripts/custom.mjs` is also loaded, as an ES module (`type="module"`), so you can use `import`. Both are checked independently and either or both may be present. Anything matching `web/server/scripts/custom*.*` is git-ignored, so additional files like `custom-config.json` stay local too.

> **Logo hook vs. the Custom Logo PNG setting.** The sample script's example — reassigning `src` on `.logo img` — targets the same images as the **Custom Logo PNG** setting. `custom.js` is injected after the page's `DOMContentLoaded` work, so on first load your script wins. But the setting re-applies on every change, so ticking, unticking, or clearing it will overwrite your logo until the next reload. Use one mechanism or the other, not both.

In Docker, mount your file in:

- **Server deployment:** `/app/server/scripts/custom.js` (or `custom.mjs`). The container runs as uid 65532, so the file must be world-readable.
- **Static deployment (archived):** `/usr/share/nginx/html/scripts/custom.js` (or `custom.mjs`)

For custom scrolling text in the bottom bar, you don't need a custom script — use the **Enable RSS Feed/Text** setting ([usage.md](usage.md#custom-scrolling-text)).

## Releases & CI

`.github/workflows/ci.yaml` is the single entry point — one workflow runs on every push, and each stage is a reusable workflow:

```
test → build → smoke → release → release image → release smoke
                          ↑ main only   ↑ only when a release was cut
```

Releases are automated with [release-please](https://github.com/googleapis/release-please):

- Commits to `main` follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` …). Only `feat:` and `fix:` bump the version — `chore:`, `ci:`, `docs:` and `build:` do not cut a release.
- release-please maintains a release PR (updating `CHANGELOG.md` and the version), and merging it tags `vX.Y.Z` and creates a GitHub Release.
- The release image build is gated on release-please's `release_created` output, **not** on the tag push. `GITHUB_TOKEN` cannot trigger downstream workflows, so a tag-triggered build only fired when a GitHub App token pushed the tag — without it a release published with no image behind it. Version tags no longer trigger anything.
- Images publish to `ghcr.io/jacaudi/ws4kp` multi-arch (amd64 + arm64): `:vX.Y.Z`, `:vX.Y` and `:vX` on a release, `:latest` from `main`, and `:sha-<short>` on every build.
- Dependency updates arrive as Renovate PRs (`fix(deps): …`), which roll into the next patch release.

Workflow changes are worth linting before pushing, since CI cannot catch a bad `needs` graph or a mistyped reusable-workflow input until it runs:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/*.y*ml
```

## Upgrading a clone from before the web/ move

The browser app and its Node toolchain now live under `web/`. In a clone made before the move,
local-only files sit at their old root paths and are no longer used: move any you want to keep.

- `server/music/*.mp3` (your own tracks) → `web/server/music/`
- `server/scripts/custom*.*` → `web/server/scripts/`
- `.env` → `web/.env`
- `dist/` and `node_modules/` are build output: delete them, then run `npm ci` in `web/`

The root `.gitignore` keeps the old `/dist/` and `/server/` paths ignored, so these leftovers are never committed by accident.

## Upgrading a clone to the Go server (v8)

The Node/Express server is gone; `npm start` in `web/` now only prints where to go instead.

- Run `task dev` (or `go run ./cmd/ws4kp --dev`) from the **repo root**.
- `.env` moves again: the server reads `.env` from its working directory, which is now the repo root. Move `web/.env` back to `.env` at the root. `web/.env` is still read by `npm run build` for build-time `OVERRIDE_*` values (static hosting only); see [deployment.md](deployment.md#configuration).
