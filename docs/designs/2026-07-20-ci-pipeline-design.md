# CI/CD Pipeline — Design

- **Repo:** jacaudi/ws4kp
- **Date:** 2026-07-20
- **Type:** design
- **Feature:** ci-pipeline
- **Status:** proposed (awaiting approval)
- **Author:** jacaudi (with Claude)

## Goal

A single, coherent CI/CD pipeline with five stages:

- **a** — code testing
- **b** — code scanning
- **c** — artifact building
- **d** — artifact testing
- **e** — release publishing

Stages **b**, **c**, **e** already exist in some form; **a** and **d** are new. This design wires all of them into one gated model with a clear trigger matrix.

## Current state (`.github/workflows/`)

| Stage | File today | Notes |
|---|---|---|
| a — testing | — | **missing** |
| b — scanning | `codeql-analysis.yml` | exists; **left as-is, deferred** (see §Deferred) |
| c — building | `build-docker.yaml` | exists; tag strategy already `sha` / +`latest` on main / +`semver` on tags |
| d — artifact testing | — | **missing** |
| e — release | `release-please.yaml` | exists; mints tag + GitHub release; App-token gated |

## Stage definitions

### a — code testing (new, blocking)
Runs in order, all blocking:
1. `npm ci`
2. `npm run lint` (production ESLint over `server/scripts`, `proxy`, `src`, root)
3. `npm run test:unit` (node:test — currently 47 tests)
4. **Integration** — reworked (see §Integration test)

### b — code scanning (deferred)
**Not built in this change.** `codeql-analysis.yml` is left untouched, and the pipeline carries a **commented-out `scan` stage placeholder** with a `TODO` pointing here. All vulnerability scanning — source (CodeQL) **and** image (Trivy/alternative) — is decided together in a separate follow-up (see §Deferred).

### c — artifact building (rewired, blocking)
Reuse the existing `docker/metadata-action` tag strategy from `build-docker.yaml`:
- `type=sha` — every build
- `latest` — on `main` and on version tags
- `semver` **v-prefixed** (`v7.1.1` / `v7.1` / `v7`, via `pattern=v{{version}}`) — on version tags only; matches the `v`-prefixed refs in the k8s/README docs

Change from today: the build is **gated behind `a`** (runs only if testing passes) instead of firing independently. Multi-arch (amd64 + arm64), LFS checkout for baked music, pushes to `ghcr.io/jacaudi/ws4kp`.

### d — artifact testing (new, blocking) — SMOKE TEST ONLY
After `c` builds the image:
1. `docker run` the built image, mapped to `:8080`
2. Wait for readiness, then assert:
   - `GET /` → `200`
   - `GET /playlist.json` → `200` (JSON) — exercises a live server route
3. Tear down.

Uses **local endpoints only** (no upstream dependency → deterministic). Catches boot/runtime regressions (the class the Transfer-Encoding 502 belonged to).

**Image vulnerability scanning (Trivy) is intentionally NOT here** — pulled into the deferred (b) scanning discussion (see §Deferred / §Security).

### e — release publishing (unchanged)
`release-please.yaml` stays as-is: on push to `main` it maintains the release PR; merging that PR mints the `vX.Y.Z` tag + GitHub release, which triggers the tag build (c + d).

## Trigger matrix

Triggering is **`on: push` only** (branches + tags). **No `pull_request` trigger** — branch-push check runs attach to the PR head commit, so they surface on the PR (and can gate branch protection) without a duplicate run. (Caveat: external fork PRs get no runs — not this repo's flow.)

| Trigger | a | b | c | d | e | image tags |
|---|:--:|:--:|:--:|:--:|:--:|---|
| push → non-default branch | ✓ | (deferred) | ✓ | ✓ | — | `sha` |
| push → `main` | ✓ | (deferred) | ✓ | ✓ | ✓ | `sha` + `latest` |
| tag `v*.*.*` (release cut) | — | — | ✓ | ✓ | (release published by e) | `sha` + `latest` + `semver` |

DAG within a run: **a → c → d** (c `needs` a; d `needs` c). On the tag event only **c → d** run (same code, re-tagged; a/b already ran on `main`).

## Integration test (rework)

`tests/index.mjs` today launches Puppeteer against `http://localhost:8080`, types locations, and **logs console output but exits 0 regardless** — a diagnostic logger, not a gate. Rework it into a real gate:

- **Boot the app first** in CI (server mode on `:8080`), wait for readiness, then run.
- **Fixed location set** (`tests/locations.json`): `Seattle, WA` · `Raleigh, NC` · `Orlando, FL` · `Anaheim, CA` · `Norman, OK` (diverse NWS offices: SEW/RAH/MLB/LOX/OUN).
- **Assert:** for each city, fail (exit non-zero) if the location never resolves (forecast never renders) or the page emits console **errors**.
- **NWS resilience:** retry a city on transient upstream failure before failing the build, so a brief `api.weather.gov` blip doesn't red the pipeline.
- Blocking by default. (If live-NWS flakiness blocking merges becomes annoying, flip this one job to non-blocking — a one-line change, noted as a fallback.)

## Deferred — the (b) scanning discussion

Explicitly out of scope here, to be designed separately:
- Source scanning: keep/extend CodeQL; consider dependency-review + secret scanning.
- **Image scanning:** whether to use Trivy (safe-pinned) or an alternative (Grype/Anchore, Docker Scout).
- Whether scanning blocks or reports.

## Security considerations

- **Pin every third-party GitHub Action by commit SHA**, not by moving tag. (Reinforced by the March 2026 Trivy supply-chain compromise, in which `aquasecurity/trivy-action` tags were force-pushed to credential-stealing malware that exfiltrated CI/CD secrets.)
- **Trivy deferred**, not adopted, for the same reason — its `trivy-action` was the weaponized vector, and this pipeline holds the GHCR push token and the release-please App key. Revisit under (b) with safe-pinned versions or an alternative.
- Least-privilege `permissions:` per job (`contents: read` by default; `packages: write` only on the build job).

## File plan

**Structure: reusable workflows** (job-level modularity). GitHub requires reusable workflows in `.github/workflows/` — "Subdirectories of the `workflows` directory are not supported" — so a `.github/ci/` folder is not possible for these (composite actions would allow `.github/ci/`, but were not chosen). `ci.yaml` is a thin orchestrator; each stage is a self-contained `on: workflow_call` file.

- **New — orchestrator:** `.github/workflows/ci.yaml` — owns the trigger matrix; its jobs are `uses:` calls into the reusable workflows with `needs`-gating (`test` → `build` → `smoke`), passing the tag/ref context as inputs and least-privilege `secrets`/`permissions`.
- **New — reusable stages** (`on: workflow_call`):
  - `.github/workflows/ci-test.yml` (a) — `npm ci` + lint + `test:unit` + integration (boots app, 5 cities, retries).
  - `.github/workflows/ci-build.yml` (c) — `docker/metadata-action` tag strategy + buildx multi-arch + push; inputs decide which tags apply.
  - `.github/workflows/ci-smoke.yml` (d) — pull/run the built image, assert `GET /` & `/playlist.json` = 200.
  - `.github/workflows/ci-scan.yml` (b) — **stub placeholder** (`on: workflow_call`, no-op with a `TODO`); its `uses:` call in `ci.yaml` is **commented out** until the scanning discussion.
- **Retire:** `.github/workflows/build-docker.yaml` — its build logic moves into `ci-build.yml` (now gated behind `test`).
- **Unchanged:** `release-please.yaml` (e), `codeql-analysis.yml` (b, deferred).
- **Reworked:** `tests/index.mjs` + `tests/locations.json` (integration gate).
- All third-party actions **pinned by commit SHA**.

## Open questions / follow-ups

1. (b) scanning — separate design.
2. Integration blocking vs. non-blocking — shipping as blocking-with-retries; easy to flip.
3. Retire vs. keep `build-docker.yaml` — this design retires it (folded into `ci.yaml`); flag if you'd rather keep it standalone.
