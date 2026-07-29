# Browser verification recipe (regional forecast and other displays)

Unit tests do not catch layout bugs. A decluttering routine that silently kept every
overlapping label passed the whole suite, because the pure function was correct and the
*measurement feeding it* was garbage. Anything that changes rendering, selection, or
layout gets checked in a real browser.

## Start a server on a free port

`WS4KP_PORT`, **not** `PORT` (`index.mjs`). Setting `PORT` silently does nothing.

```bash
WS4KP_PORT=8136 node index.mjs &
```

Use a fresh port per run. A stale server on the old port will happily serve the
previous build and you will "verify" code you did not change. Confirm the served module
actually contains your edit:

```js
const src = await (await fetch('/scripts/modules/regionalforecast.mjs', { cache: 'reload' })).text();
src.includes('yourNewFunctionName');   // must be true
```

## Reach the display fast

Displays draw lazily when the rotation reaches them. Uncheck everything else:

```js
[...document.querySelectorAll('input[type=checkbox][id$="-checkbox"]')]
  .forEach(b => { const want = b.id.includes('regional'); if (b.checked !== want) b.click(); });
window.getForecastFromLatLon(27.9465, -82.4593);   // bypasses the flaky geocoder
```

The display element is `#regional-forecast-html` (**not** `#regional-forecast`), and it
carries class `show` when active.

## Measure the way the code measures

`.location` elements have **height 0** — their children carry the visible box. Testing
overlap with the element's own `getBoundingClientRect()` finds nothing and is wrong.
Union the children, and subtract the container origin:

```js
const boxOf = (l) => {
  let L=Infinity,T=Infinity,R=-Infinity,B=-Infinity;
  [...l.children].forEach(c => { const r=c.getBoundingClientRect(); if(!r.width) return;
    L=Math.min(L,r.left); T=Math.min(T,r.top); R=Math.max(R,r.right); B=Math.max(B,r.bottom); });
  return { left:L-cr.left, top:T-cr.top, right:R-cr.left, bottom:B-cr.top };
};
```

If `L` is still `Infinity`, the element had no layout when measured. **That is the bug
signature** — collision code comparing `Infinity < -Infinity - pad` is false for every
pair and quietly does nothing. Assert boxes are finite before trusting any result.

## Sample over time, not once

The display redraws on screen rotation and on data refresh. A single sample can land in
a good frame and hide a real problem — an overlap was observed, then absent, then the
temperatures changed (84 → 93) revealing a refresh had redrawn everything. Sample once
a second for ~20s and aggregate, checking each frame for:

- label-on-label overlap (union boxes, small pad)
- labels intersecting chrome: `.header`, `.logo`, `.title`, `.date-time`, `.scroll`
- labels escaping `.main`'s bounds
- any degenerate (non-finite) measurement

Report counts across all samples, and test at least one dense metro (NYC, Chicago) as
well as a coastal/sparse one (Tampa) — density is where collisions appear.

## A/B against main when a count changes

If your change alters how many labels appear, prove the delta is correct rather than a
regression: `git stash`, run `main` on another port, measure identically, restore. Then
check whether the *extra* labels on `main` were at clamp sentinels (`y === 30`,
`y === maxY`, `x === 40`, `x === maxX`) — that is how three labels were shown to be
pinned to the border at coordinates that did not match their real locations.

## Clean up

`pkill -f "node index.mjs"`, and delete `.playwright-mcp/` and any stray screenshots
before committing.
