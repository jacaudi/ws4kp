# Regional Forecast Density — Implementation Plan

- **Repo:** `ws4kp`
- **Date:** 2026-05-24
- **Author:** jacaudi
- **Status:** Ready to execute
- **Design:** [2026-05-24-regional-forecast-density-design.md](./2026-05-24-regional-forecast-density-design.md)
- **GitHub issue:** [jacaudi/ws4kp#1](https://github.com/jacaudi/ws4kp/issues/1)
- **Scope rule:** minimal change. Don't refactor surrounding code. Don't add abstractions beyond what the design requires.

## Architecture / context

- ES6 module browser app, no framework.
- Affected files: `server/scripts/modules/regionalforecast.mjs`, `server/scripts/modules/regionalforecast-utils.mjs`.
- No test infrastructure exists; verification is manual against the live app.

## For Claude — REQUIRED EXECUTION WORKFLOW (follow in order)

1. `superpowers:using-git-worktrees` — Isolate work in a dedicated worktree.
2. `superpowers:subagent-driven-development` — Dispatch a fresh subagent per task.
3. `superpowers:test-driven-development` — Project has no test infra; for each task, the subagent's verification report must document the manual steps run.
4. `superpowers:verification-before-completion` — Verify per task before marking complete.
5. `superpowers:requesting-code-review` — Per-task review (built into subagent-driven-development).
6. After all tasks: comprehensive review on the full branch diff (automatic).
7. `superpowers:finishing-a-development-branch` — Complete the branch.

Skills carry their own model and effort settings. Do not override them.

## Tasks

### T1 — Fix AK/HI return bug in `getXYForCity`

**File:** `server/scripts/modules/regionalforecast-utils.mjs`

The AK and HI branches at the top of `getXYForCity` call the variant functions without returning their result. Execution falls through to the CONUS math and mislocates AK/HI cities.

**Change:** add `return` to both branches. Two lines.

**Acceptance:**
- AK and HI branches return their respective variant's result.
- Manual smoke test: load with an Alaska lat/lon and a Hawaii lat/lon; picks land on the corresponding regional map.

### T2 — Implement the density-aware two-pass selection

**File:** `server/scripts/modules/regionalforecast.mjs`

Two coordinated changes in this file:

1. Extend `scaling()` to also return the per-mode tuning constants from the design's table: `base`, `bias`, `cap`, `pass1`, `curatedCap`, `maxPass2Dist`, `gcols`, `grows`. Numbers come from the design doc — copy directly.
2. Inside `getData`, replace the existing `combinedCities.forEach(... regionalCities.push(city))` block with the design's two-pass selection: pre-filter (bbox + user-exclusion + distance/cell tagging + sort by distance), pass 1a (curated), pass 1b (stations), pass 2 (gap-fill with `maxPass2Dist` gate). Use `calcDistance` from `utils/calc.mjs` (already imported).

Define `USER_EXCLUSION = 0.25` as a module-level const.

> **Note:** The `base` values in the design doc table were tuned upward during implementation after observing marker overlap in the live app (see the design doc's "Per-mode tuning constants" section for the updated values and rationale). The implementation uses the values from that table, not any numbers that may appear elsewhere in this plan.

Keep the rest of `getData` (the `regionalDataAll = await safePromiseAll(...)` block and the `this.data = { ... }` assignment) unchanged.

**Acceptance:**
- For three geographically diverse US locations, the resulting picks visually match the preview tool's output (`docs/_review-chunks/regional-preview.html`).
- No new imports needed beyond what the file already has.
- API fan-out is bounded by `cap` per location change.
- `STATUS.loaded` / `STATUS.noData` / `STATUS.failed` transitions still trigger correctly (no candidates → `STATUS.noData`; non-empty pool but every fetch fails → `STATUS.noData`).
- The pickled `mapOffsetXY` and `available` values passed downstream are unchanged.

### T3 — Manual verification against the live app

Run `npm start`, set the location to several geographically diverse places (one in a sparse-population region, one in a dense-population region, one coastal, one continental), and confirm:

- Standard 4:3: between 6 and 10 cities; no marker on the user's own location; recognizable curated cities appear when in bbox.
- Widescreen Enhanced 16:9: between 10 and 14 cities; the eastern third of the canvas has at least one pick.
- Portrait Enhanced: between 14 and 20 cities; picks spread vertically across the canvas, not just clustered near the user.
- No regression on the existing `noData` / `failed` paths (test by setting location to a spot with no nearby stations).

Capture before/after screenshots for the PR description.

## Risk

- **API cost:** Bounded by per-mode `cap`. Server mode proxy absorbs repeats. Static deployments will see roughly 2×–4× the request volume per location change versus today.
- **Regression risk:** Low. Changes are local to `regionalforecast.mjs#getData` and a two-line fix in `regionalforecast-utils.mjs`. No changes to the `WeatherDisplay` lifecycle, navigation contract, or rendering path.
- **AK/HI:** T1 is a prerequisite. After T1, AK/HI use correct projection math but with the new algorithm; T3's manual verification should include at least one AK or HI lat/lon.
- **Basemap projection mismatch:** out of scope. Markers may still appear slightly off the basemap; that is no worse than today and is a property of the basemap, not the new algorithm.

## Out of scope

- Basemap projection alignment.
- Wiring `utils/cache.mjs` into the fetch path.
- Adding non-station candidate sources.
- Further tuning of per-mode constants beyond what the design table specifies.
- Any refactoring of code not directly required by T1–T3.
