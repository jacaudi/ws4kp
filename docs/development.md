# Development & Customization

- [Tech stack](#tech-stack)
- [Build & run](#build--run)
- [Checks: `task ci`](#checks-task-ci)
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
- ESLint (airbnb-extended, flat config) for consistent style, and a `tsc --checkJs` type-check ratchet
- [Task](https://taskfile.dev/) (`taskfile.yml`) as the one entry point for every check, locally and in CI

## Build & run

```bash
npm --prefix web ci
task dev                      # development: web/server/ from disk, caching proxy, rebuilds on change
npm --prefix web run build    # produce web/dist/
go run ./cmd/ws4kp            # production: the build embedded in the binary
```

`task dev` renders `views/index.ejs` to `web/.dev/index.html` and recompiles `ws.min.css` whenever their sources change, while the Go server serves `web/server/` from disk; reload the page to pick up an edit. The binary embeds `web/dist/` when it is compiled, so after `npm run build` restart `go run` to serve the new build.

See [deployment.md](deployment.md) for every run mode and the Docker builds.

## Checks: `task ci`

`task ci` runs everything CI's `test` job runs, with the same command, so a green local run means a green `test` job — locally, actionlint checks workflow changes since HEAD~1; set `BASE_REF=origin/main task ci` to lint everything since main. Run it from the repo root before pushing. `task --list` shows every target.

| Target | What it runs |
|---|---|
| `task ci` | `repo:ci`, `go:ci`, `node:ci`, then lint and unit tests for the upstream-review scripts |
| `task lint` / `task test` | lint, format and type checks (no tidy or govulncheck) / the tests only (run `npm --prefix web ci` first) |
| `task repo:ci` | actionlint (when workflows changed), every local `uses:` resolves, yamllint, hadolint |
| `task go:ci` | `golangci-lint fmt --diff`, `go mod tidy -diff`, `golangci-lint run`, `govulncheck ./...`, `go test -race ./...` |
| `task node:ci` | in `web/`: `npm ci`, `eslint --max-warnings 0 .`, the type-check ratchet, `npm test` |
| `task integration` | builds the site and the binary, serves it, and runs the Puppeteer test (`web/tests/index.mjs`, five cities against live NWS). `STRICT=1` fails on an upstream outage instead of warning; `WS4KP_PORT=8137` picks another port |
| `task smoke IMAGE=…` | boots an image and probes it, as CI's `smoke` job does (`SMOKE_PORT` for another host port) |
| `task build` | `npm run build`, then `go build` into `bin/` |
| `task dev` | the edit-and-reload loop above |

**Tools.** `task ci` needs Go, Node 24 (`.node-version`), Task, actionlint, yamllint, hadolint, golangci-lint and govulncheck on `PATH`; CI installs them in `.github/actions/setup/`. golangci-lint must be **v2.14 or newer**: older releases cannot analyze this module (v2.13 fails reading Go 1.27 export data). CI installs the v2.15.0 release; locally, upgrade yours (for example `brew upgrade golangci-lint`). If `golangci-lint --version` still reports an older release, another copy earlier on `PATH` (often `~/.go/bin/golangci-lint` from a past `go install`) is shadowing it: remove that copy or reinstall it at v2.14 or newer.

**Static analysis** is golangci-lint (`.golangci.yml`: the fleet baseline, which includes `gosec`, `staticcheck`, `govet`, `errcheck`, `revive` and `bodyclose`, plus `noctx` and `gochecknoinits`), govulncheck for known vulnerabilities in reachable dependency code, and eslint. There is no CodeQL.

**eslint** covers all of `web/`, `web/tests/` included, and `task tooling:lint` covers `.claude/skills/upstream-review/`. `web/tests/` is its own npm package (Puppeteer and chalk stay out of the image's `npm ci`), so the config lets its imports resolve outside `web/package.json`.

### The type-check ratchet

The browser and Node code is plain JavaScript checked by `tsc --checkJs` (`web/tsconfig.browser.json`, `web/tsconfig.node.json`, with page globals declared in `web/types/globals.d.ts`). It predates type checking and has debt, so the gate is a ratchet rather than zero errors: `npm run typecheck` (`web/scripts/tsc-ratchet.mjs`) counts diagnostics per file and error code and compares them with `web/tsc-baseline.json`.

- A count that rises, or a new file/code pair, **fails**. Fix the new error.
- Equal counts pass. Lower counts pass too, and print `tsc baseline can be lowered: run npm run typecheck -- --update`.
- Diagnostics in `server/scripts/vendor/` are ignored: Renovate regenerates those files.

`npm run typecheck -- --update` rewrites the baseline to the current counts, up or down. Use it **only** in a commit whose message says why: debt paid down, a file renamed or moved, a vendored-package bump (Renovate's `updateVendor` PRs), or a TypeScript / `@types/node` bump. Renovate opens `typescript` and `@types/node` as one PR; if that PR changes the counts, its ratchet fails, and the fix is a follow-up commit on the Renovate branch that runs `--update` and says so. Renovate holds `typescript` below 6.1.0 (typescript-eslint's peer range) and `@types/node` below 25 (the Node in `.node-version`).

## The custom script hook

`web/server/scripts/custom.js` lets you customize your own fork without pushing changes back upstream. A sample lives at `web/server/scripts/custom.sample.js` — copy it to `custom.js` to activate it.

`web/server/scripts/custom.mjs` is also loaded, as an ES module (`type="module"`), so you can use `import`. Both are checked independently and either or both may be present. Anything matching `web/server/scripts/custom*.*` is git-ignored, so additional files like `custom-config.json` stay local too.

> **Logo hook vs. the Custom Logo PNG setting.** The sample script's example — reassigning `src` on `.logo img` — targets the same images as the **Custom Logo PNG** setting. `custom.js` is injected after the page's `DOMContentLoaded` work, so on first load your script wins. But the setting re-applies on every change, so ticking, unticking, or clearing it will overwrite your logo until the next reload. Use one mechanism or the other, not both.

In Docker, mount your file in:

- **Server deployment:** `/app/server/scripts/custom.js` (or `custom.mjs`). The container runs as uid 65532, so the file must be world-readable.
- **Static deployment (archived):** `/usr/share/nginx/html/scripts/custom.js` (or `custom.mjs`)

For custom scrolling text in the bottom bar, you don't need a custom script — use the **Enable RSS Feed/Text** setting ([usage.md](usage.md#custom-scrolling-text)).

## Releases & CI

`.github/workflows/ci.yaml` is the single entry point — one workflow runs on every push, and each stage is a local reusable workflow (`ci-*.yml`):

```
test → context → build → smoke ─┬→ release → release image → release smoke
integration ────────────────────┘   ↑ main only   ↑ only when a release was cut
```

`integration` runs alongside `test` and gates nothing before `release`; it feeds only `release` and `ci`.

- **test** runs `task ci`; **integration** runs `task integration`. An upstream outage during the integration test (exit 75) is a warning, not a failure; `ci-nightly.yml` re-runs it every night with `STRICT=1`, so sustained breakage still turns something red.
- **build** and **smoke** run on `main`, on manual dispatch, and on any branch with an open pull request (a draft counts). A push with no PR is tested but not built; open a draft PR to get an image.
- **`ci`** is the one required status check. It passes only when `context`, `test` and `integration` succeeded and `build` and `smoke` succeeded, or were skipped because no PR was open.

Releases are automated with [release-please](https://github.com/googleapis/release-please):

- Commits to `main` follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` …). Only `feat:` and `fix:` bump the version — `chore:`, `ci:`, `docs:` and `build:` do not cut a release.
- release-please maintains a release PR (updating `CHANGELOG.md` and the version), and merging it tags `vX.Y.Z` and creates a GitHub Release.
- The release image build is gated on release-please's `release_created` output, **not** on the tag push. `GITHUB_TOKEN` cannot trigger downstream workflows, so a tag-triggered build only fired when a GitHub App token pushed the tag — without it a release published with no image behind it. Version tags no longer trigger anything.
- Images publish to `ghcr.io/jacaudi/ws4kp` multi-arch (amd64 + arm64): `:vX.Y.Z`, `:vX.Y` and `:vX` on a release, `:latest` from `main`, and `:sha-<short>` on every build.
- Dependency updates arrive as Renovate PRs (`fix(deps): …`), which roll into the next patch release.

Workflow changes are worth linting before pushing, since CI cannot catch a bad `needs` graph or a mistyped reusable-workflow input until it runs. `task repo:ci` runs actionlint and also checks that every local `uses:` path exists, which actionlint does not.

The branch ruleset for `main` is kept in `.github/rulesets/main.json`: it requires `ci`, blocks force pushes and deletion, and requires a pull request with resolved conversations, with a bypass for repository admins.

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
