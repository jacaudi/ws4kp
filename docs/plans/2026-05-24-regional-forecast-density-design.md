# Regional Forecast Density — Design

- **Repo:** `ws4kp`
- **Date:** 2026-05-24
- **Author:** jacaudi (design captured via Claude Code review)
- **Status:** Approved, pending implementation
- **Related:** [Implementation plan](./2026-05-24-regional-forecast-density-implementation.md)

## Problem

The Regional Forecast display picks roughly 4–6 cities regardless of available canvas size, leaving significant empty space — especially in Widescreen Enhanced (16:9) and Portrait Enhanced modes, which were added specifically to use more pixels. Three structural issues feed this:

1. **No density signal from display mode.** The spacing constant in `regionalforecast.mjs#getData` is hardcoded to `targetDistance = 2.4°` (`1°` for HI) and ignores the mode passed in from `scaling()`.
2. **Array-order picks override locality.** The greedy filter walks `[...RegionalCities, ...Object.values(StationInfo)]` in its native order, so a station far from the user but earlier in iteration can win a slot over a curated city closer to the area of interest. Conversely, recognizable curated cities can be silently filtered out by closer station candidates.
3. **The user's own location appears as a duplicate marker.** A candidate co-located with the user's home gets picked normally, even though the same data is on the "Current Conditions" panel.

## Goals

- Increase city density to match the available canvas in each display mode.
- Bias picks toward cities geographically near the user.
- Promote curated cities from `regionalcities.json` ahead of equally-close NOAA stations, so familiar names appear on the map.
- Never render the user's own location as a regional marker.
- Avoid reaching far outside the user's region to color empty cells.

## Non-goals

- **Basemap projection mismatch.** `getXYFromLatLon` (linear) and the rendered `basemap.webp` (apparently a conic projection) don't agree, so city markers may appear slightly off the basemap. This is a pre-existing condition unrelated to which cities we pick; tracked separately.
- **Replacing the curated city list.** `datagenerators/output/regionalcities.json` stays as-is.
- **Adding new candidate sources.** The pool remains `RegionalCities ∪ Object.values(StationInfo)`.
- **Caching layer for the regional forecast HTTP calls.** Out of scope.

## Design

A two-pass selection per display mode, replacing the current array-order single-pass filter inside `regionalforecast.mjs#getData`.

### Per-mode tuning constants (emitted by `scaling()`)

| Mode | `base`° | `bias` | `cap` | `pass1` | `curatedCap` | `maxPass2Dist`° | grid |
|---|---|---|---|---|---|---|---|
| Standard 4:3 | 1.25 | 0.20 | 10 | 7 | 3 | 6.5 | 3×3 |
| Widescreen Enhanced 16:9 | 1.00 | 0.20 | 14 | 10 | 4 | 9.0 | 4×3 |
| Portrait Enhanced | 0.90 | 0.20 | 20 | 12 | 6 | 12.0 | 3×5 |

The `base` values above were increased from the original design values (0.70 / 0.55 / 0.50) during implementation after observing marker overlap in the running application. Initial validation used a browser-based Leaflet preview whose marker glyphs are noticeably smaller than the icon + temperature + city-name labels rendered on the ws4kp canvas; at the canvas's pixel scale (~57 px/° longitude, ~70 px/° latitude), the original spacing left insufficient room between adjacent markers in the near-user cluster. A second visual pass after the first tuning commit revealed residual label overlap in the near-user cluster and empty space at the bbox edges in enhanced modes, prompting a further nudge of `base` (1.20/0.95/0.85 → 1.35/1.10/1.00) and an increase of `maxPass2Dist` (5.0/6.0/8.0 → 6.5/9.0/12.0°) so that pass-2 gap-fill reaches cells near the bbox perimeter. A third pass pulled `base` back ~10% (1.35/1.10/1.00 → 1.25/1.00/0.90) after the prior bump left enhanced modes with too few picks against their per-mode caps. A fourth pass reduced `bias` (0.35 → 0.20) across all modes after visual review showed the steeper radial spacing was rejecting too many mid-distance (1–3°) candidates and leaving notable bbox-interior cells unfilled. All other constants (`cap`, `pass1`, `curatedCap`, grid) are unchanged from the original design.

Meanings:

- **`base`** — minimum spacing (degrees) between picked cities at the user's location.
- **`bias`** — radial growth factor on spacing. Required spacing for a candidate at distance `d` from the user is `base × (1 + bias × d)`. Distant picks must be farther apart; near picks can cluster more tightly.
- **`cap`** — soft total ceiling on picked cities; bounds API fan-out per location change.
- **`pass1`** — proximity-phase ceiling (passes 1a + 1b combined).
- **`curatedCap`** — soft ceiling on curated picks within pass 1a; prevents curated entries from dominating in regions where many curated cities are in-bbox.
- **`maxPass2Dist`** — pass 2 will not fill empty cells whose geometric center is farther than this from the user.
- **grid** — `gcols × grows` subdivision of the bbox used by pass 2.

### Pixel-asymmetric spacing guard (shared across all modes)

Lat/lon spacing alone does not model the rendered marker footprint. Each marker carries an icon plus a temperature plus a city-name label that extends roughly 80 px to the right of the marker anchor, so two markers whose centers satisfy the degree-spacing rule can still produce visually overlapping labels when their canvas rows are similar. After the four `base`/`bias` tuning passes above, a pixel-level guard was added on top of the degree-spacing check:

- **`PX_MIN_DX = 110`** — minimum horizontal pixel separation.
- **`PX_MIN_DY = 40`** — minimum vertical pixel separation.
- **Rule:** every newly-picked candidate must satisfy `|Δx_px| ≥ PX_MIN_DX OR |Δy_px| ≥ PX_MIN_DY` against every already-picked marker, in addition to the degree-spacing requirement. Either-axis separation is sufficient; only both-axes-close pairs are rejected.

The pixel coordinates come from a single `getXYForCity` call tagged onto each candidate during the pre-filter (not recomputed per spacing check). The pixel rule applies in all three passes (1a, 1b, 2) and is not relaxed in pass 2 even though the degree rule is (`× 0.7`). Initial thresholds of 85/30 px proved too permissive — horizontally-aligned pairs ~100 px apart passed the OR check while their labels (which extend ~80 px right of the marker) still visually overlapped — so the values were tightened to 110/40 px based on observed worst-case deltas.

### Top-edge y-floor in `getXYForCity`

Independent of the selection algorithm, the marker projection in `regionalforecast-utils.mjs` clamps each marker's `y` to a minimum to keep it on-canvas. The original floor of `y = 30` placed top-edge picks beneath the title/logo chrome whenever the user's location sat far enough south that the bbox's top edge mapped near the top of the canvas. The floor was raised iteratively — `30 → 80 → 130 → 115 → 55` — in all three variants (CONUS, AK, HI) as visual review refined the target clearance. The final `55` value leaves roughly 1–2 px of vertical clearance between the bottom of the header chrome (~y=50) and any clamped marker — the user explicitly preferred this minimal gap over the wider buffers earlier iterations applied. This is an adjacency-readability fix, not an algorithm change — the projection math, the per-mode tuning constants, and the selection passes are unchanged.

### Portrait cell bbox (pass-2 grid optimization)

In Portrait Enhanced mode the canvas-sized bbox is unusually tall, so when the user's location is near a coast or an otherwise sparsely-populated edge, the bottom (or top) rows of the pass-2 cell grid can land over ocean or empty terrain. Those cells have no candidates and pass 2 cannot fill them, leaving the canvas visibly sparse.

To fix this without changing the visible bbox or the basemap projection, pass 2 builds its cell grid from a **tighter bbox derived from the actual extent of the surviving candidates** (after pre-filter, USER_EXCLUSION, and sort). Specifically:

- After pre-filter, compute `candMinLat / candMaxLat / candMinLon / candMaxLon` across `candidates`.
- Use that tighter rectangle as `cellBbox` for `latStep`, `lonStep`, `cellOf`, and `cellCenter` — pass 2's whole grid math.
- Fall back to the visible bbox if `candidates.length === 0` or the candidate extent is degenerate (zero-width in either axis), to avoid divide-by-zero in `latStep`/`lonStep`.
- `cellOf` adds a `Math.max(0, ...)` lower-bound clamp so the user's `userCell` stays in-range even if the user sits outside the tightened rectangle.

This is scoped to Portrait via a `tightCellBbox` flag emitted by `scaling()`; Standard 4:3 and Widescreen Enhanced 16:9 use the visible bbox unchanged. Pre-filter still runs against the visible bbox (we still consider all candidates in the user's region), and the basemap continues to render at its visible-bbox geometry. Only pass 2's cell geometry sees the tighter bbox.

### Pre-filter

1. Compute the bbox via existing `getXYFromLatLon` + `getMinMaxLatitudeLongitude` (no change to those functions).
2. Filter the candidate pool to entries inside the bbox.
3. **User-exclusion guard:** drop any candidate within `USER_EXCLUSION = 0.25°` of the user's lat/lon.
4. Tag each surviving candidate with `dist` (Euclidean lat/lon distance to user) and `cell` (which grid cell of the bbox it falls in — lat/lon-based subdivision).
5. Sort ascending by `dist`.

### Pass 1a — Curated cities first

Walk candidates in distance order. For each entry whose source is curated, accept if its distance from every already-picked city is at least `base × (1 + bias × dist)`. Stop when `picked.length == curatedCap`.

### Pass 1b — Stations fill remaining proximity slots

Continue walking candidates. For each station entry, accept under the same spacing rule (now testing against the curated picks from 1a too). Stop when `picked.length == pass1`.

### Pass 2 — Gap fill

1. Identify cells with no pick from pass 1.
2. **Drop empty cells whose geometric center is farther than `maxPass2Dist` from the user.** This is the key constraint that keeps gap-fill from reaching into adjacent regions just to color a far cell.
3. Visit the remaining empty cells in order of Manhattan distance from the user's cell.
4. For each cell, list its candidates sorted by distance-to-cell-center (not distance-to-user). The first candidate that satisfies a relaxed spacing requirement (`base × (1 + bias × dist) × 0.7`) is picked. The relax factor lets pass 2 land picks in cells where the strict pass-1 spacing would have blocked them.
5. Stop when `picked.length == cap`.

## Trade-offs

- **`curatedCap` is a soft ceiling, not a quota.** Sparse-curated bboxes will fall short of the ceiling and pass 1b will absorb the slack. Dense-curated bboxes won't dominate.
- **Radial bias `0.35`** keeps picks tight near the user and spreads them out far away. Setting `bias = 0` reverts to uniform spacing. Setting it higher produces a more star-burst distribution.
- **`maxPass2Dist`** trades coverage against locality. Numbers chosen to approximately match the canvas-relevant area per mode.
- **API cost.** Each picked city is 2 NWS HTTP calls (gridpoint forecast + observation station list). Caps bound the fan-out: ~20 calls per location change in Standard, up to ~40 in Portrait. The server-mode proxy cache absorbs repeats; static deployments will see the full cost on each location change.

## Validation

The algorithm was validated against multiple geographically diverse US locations using a browser-based preview (`docs/_review-chunks/regional-preview.html`). The preview renders picks on real geography (Leaflet + OpenStreetMap tiles) so locality and density can be judged independent of the basemap projection mismatch noted under Non-goals.

## Future work (separate plans)

- Basemap projection mismatch between `getXYFromLatLon` and `basemap.webp`.
- Wiring `utils/cache.mjs` (currently dead code) into the regional forecast fetch path.
- Broadening the candidate pool with a non-station gazetteer (e.g., GeoNames cities1000) for cities with no NWS observation station.
