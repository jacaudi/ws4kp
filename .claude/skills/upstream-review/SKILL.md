---
name: upstream-review
description: Use when comparing this fork against netbymatt/ws4kp upstream — checking what upstream changed, deciding what to adopt, or planning an upstream catch-up. Triggers on "check upstream", "how far behind are we", "upstream catch-up", "what's new upstream", "compare with upstream".
---

# Upstream Review (ws4kp fork)

Compare `jacaudi/ws4kp` against `netbymatt/ws4kp`, decide what to adopt, and present
findings. This fork has diverged deliberately in specific places; the job is to take
upstream's fixes **without** losing the fork's work, and to notice where upstream's
changes interact badly with fork-specific code.

## Prime directive

**Commit counts lie. Compare content, not history.**

This fork adopts upstream changes file-by-file rather than merging, so
`git rev-list --count main..upstream/main` stays high forever and means nothing. It
read "17 behind" both before and after a catch-up that achieved byte-parity on 9 of
17 files. Always report **content parity per file**, never a commit count, and say so
explicitly when a stakeholder quotes the commit number.

## Step 1 — Establish the ground truth

```bash
git fetch upstream                      # tags will be REJECTED; see note below
B=$(git merge-base main upstream/main)
git log --oneline $B..upstream/main     # what upstream did
```

`git fetch upstream --tags` fails with "would clobber existing tag" because both repos
use release-please and mint the same `vX.Y.Z` names for *different* commits. That is
expected and harmless. Never force-fetch upstream tags — it would repoint this fork's
release tags at upstream commits.

## Step 2 — Partition the files (this is the whole trick)

```bash
git diff --name-only $B..main         | sort > /tmp/fork.txt
git diff --name-only $B..upstream/main | sort > /tmp/up.txt

comm -12 /tmp/fork.txt /tmp/up.txt   # CONTESTED — both sides changed
comm -13 /tmp/fork.txt /tmp/up.txt   # upstream-only — clean apply
```

The upstream-only set applies with `git checkout upstream/main -- <file>` and needs no
judgement. In practice this is most of the change: a recent catch-up had 9 of 17 files
in this bucket. Do this partition **before** reading any diffs — it turns "17 commits of
conflict" into "two files that need thought".

Within the contested set, sort further:

- **Generated** (`server/styles/ws.min.css`, `.map`) — never hand-merge. Take the
  `.scss` source, then `npm run build:css`, and confirm the rule actually compiled.
- **Metadata** (`package.json`, `package-lock.json`) — the fork intentionally runs
  ahead (ejs 6, suncalc 2, eslint 10). Take only specific dependency *additions*
  upstream needs for a file you adopted.
- **Prose** (`README.md`, `docs/`) — the fork rewrote these. Port the *fact*, not the diff.
- **Real code** — the only place judgement is required.

## Step 3 — Check whether a "conflict" is actually obsolete

An upstream change to a contested file is often retuning code this fork **deleted**.
Read it before agonising. Real example: upstream's regional-city commit changed
`regionalforecast.mjs`, but the change was `targetDistance 2.4 → 10` and
`targetDist 1 → 1.5` — constants of the selection algorithm this fork replaced
wholesale. Nothing to port.

Conversely, check whether a fork file is byte-identical to the merge-base. If it is,
upstream's fix to it is a **live bug here** and applies cleanly. That is how the
offshore-marine null-grid 404 fix was found.

## Step 4 — Hunt for data/contract hazards (do not skip)

The most dangerous upstream changes are not code conflicts — they are **data format
changes that silently break fork-specific code**. Always:

1. Diff the shape of any adopted data file, not just its size:
   ```bash
   node -e "const a=require('./x.json'); console.log(typeof a[0].lat, typeof a[0].lon)"
   ```
2. Compare against every other feed merged into the same structure.
3. Grep fork-only helpers for `+` on values from that data. Subtraction and `<`/`>`
   coerce strings fine; **`+` concatenates**, and the result is either `NaN` or a
   wrong-but-finite number.

This is not hypothetical. Upstream's expanded `regionalcities.json` ships `lat`/`lon`
as **strings** while `stations.json` uses **numbers**. Both feed one candidate pool.
`geoDistance` takes a midpoint via `(lat1 + lat2)`, so the distance became `NaN`, every
`NaN >= minSpacing` was false, and selection silently collapsed **from 13 cities to 1**
with nothing thrown. Upstream was immune because their distance helper only subtracts.

Prove such a finding with real data before claiming it:

```bash
node --input-type=module -e "
import { selectRegionalCities } from './server/scripts/modules/regionalforecast-select.mjs';
// build the pool both ways and print the counts
"
```

## Step 5 — Decide, and put the decision to the user

For each contested item classify as: **adopt**, **already have it**, **obsolete for this
fork**, or **conflicts with a deliberate fork feature**. Only the last needs a decision,
and it is the user's — present it with a recommendation and the trade-off, don't just pick.

Standing decisions (do not silently reverse):

- The fork keeps its **density-aware regional selection** (`regionalforecast-select.mjs`)
  over upstream's fixed-pixel AABB. It measures real rendered boxes and scales to
  portrait/wide. Take upstream's *correctness* fixes into that structure instead.
- The fork's CI is a **single composed `ci.yaml`**; upstream has none.
- Version/tag lineage is independent.

## Step 6 — Package by risk

Split into separate PRs when risk profiles differ; fold trivia into the open PR:

- **Low risk** — files the fork never touched, data, generated CSS, isolated guards.
- **Needs eyes** — anything that changes rendering, selection, or layout.

## Step 7 — Verify like you mean it

- `npm run test:unit` — the CI-relevant suite.
- `rtk proxy npm run lint` — raw/uncached. `npm run lint` is CI's scope; `lintall`
  includes `tests/` and has **pre-existing** failures. Compare against clean `main`
  before blaming your change.
- `npm run build:css` after any `.scss` change, then grep the minified output for the
  compiled rule.
- **Rendering changes require a browser.** Unit tests did not catch that decluttering
  was a silent no-op. See `.claude/skills/upstream-review/browser-verify.md`.
- Re-run the Step 2 partition at the end and report per-file parity.

## Reporting

Lead with what is contested and what it costs — not a commit count. Give a table of
upstream fixes with whether each applies clean, call out anything that is a live bug in
this fork, and state the one or two genuine decisions plainly with a recommendation.
