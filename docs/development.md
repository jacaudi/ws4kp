# Development & Customization

- [Tech stack](#tech-stack)
- [Build & run](#build--run)
- [The `custom.js` hook](#the-customjs-hook)
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

## The `custom.js` hook

`server/scripts/custom.js` lets you customize your own fork without pushing changes back upstream. A sample lives at `server/scripts/custom.sample.js` — copy it to `custom.js` to activate it (`custom.js` is git-ignored).

In Docker, mount your file in:

- **Server deployment:** `/app/server/scripts/custom.js`
- **Static deployment (archived):** `/usr/share/nginx/html/scripts/custom.js`

For custom scrolling text in the bottom bar, you don't need `custom.js` — use the **Enable RSS Feed/Text** setting ([usage.md](usage.md#custom-scrolling-text)).

## Releases & CI

This fork automates releases with [release-please](https://github.com/googleapis/release-please):

- Commits to `main` follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` …).
- release-please maintains a release PR (updating `CHANGELOG.md` and the version), and merging it tags `vX.Y.Z` and creates a GitHub Release.
- The tag triggers the container build, publishing `ghcr.io/jacaudi/ws4kp:vX.Y.Z` (plus `:latest` from `main` and `:sha-<short>` on every build), multi-arch (amd64 + arm64).
- Dependency updates arrive as Renovate PRs (`fix(deps): …`), which roll into the next patch release.
