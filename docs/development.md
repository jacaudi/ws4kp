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
- Hand-written CSS managed with SASS
- ESLint (airbnb-base) for consistent style

Unit tests for the newer pure-logic modules use Node's built-in test runner:

```bash
npm run test:unit
npm run lint        # production modules
npm run lintall     # + datagenerators, gulp, tests
```

## Build & run

```bash
npm install
npm start                 # development (individual modules, caching proxy)
npm run build             # produce dist/
DIST=1 npm start          # production (minified bundles)
```

See [deployment.md](deployment.md) for every run mode and the Docker builds.

## The custom script hook

`server/scripts/custom.js` lets you customize your own fork without pushing changes back upstream. A sample lives at `server/scripts/custom.sample.js` — copy it to `custom.js` to activate it.

`server/scripts/custom.mjs` is also loaded, as an ES module (`type="module"`), so you can use `import`. Both are checked independently and either or both may be present. Anything matching `server/scripts/custom*.*` is git-ignored, so additional files like `custom-config.json` stay local too.

In Docker, mount your file in:

- **Server deployment:** `/app/server/scripts/custom.js` (or `custom.mjs`)
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
