---
name: upstream-review
description: Use when comparing this fork against its upstreams — netbymatt/ws4kp (code) and netbymatt/ws4kp-music (the bundled music) — checking what changed, deciding what to adopt, or planning a catch-up. Triggers on "check upstream", "how far behind are we", "upstream catch-up", "what's new upstream", "compare with upstream", "new music", "check the music repo".
---

# Upstream Review (ws4kp fork)

Compare `jacaudi/ws4kp` against its upstreams, decide what to adopt, and present
findings. This fork has diverged deliberately in specific places; the job is to take
upstream's fixes **without** losing the fork's work, and to notice where upstream's
changes interact badly with fork-specific code.

Two upstreams are tracked, each under `sources` in `.upstream-sync.json`, and a review
covers both:

| Source key | Repo | What it feeds | Baseline | Procedure |
|---|---|---|---|---|
| `ws4kp` | netbymatt/ws4kp | all the code | release tag + sha | Steps 1–7 |
| `ws4kp-music` | netbymatt/ws4kp-music | `web/server/music/default` | commit sha (no tags) | [Music source](#music-source-ws4kp-music) |

A new upstream is a new key under `sources` plus its own procedure section here.

## Prime directive

**Commit counts lie. Compare content, not history.**

This fork adopts upstream changes file-by-file rather than merging, so
`git rev-list --count main..upstream/main` stays high forever and means nothing. Since
the LFS history rewrite removed the common ancestor entirely, it now reads **896** —
upstream's whole history — and will stay there no matter how complete the parity is.
Before the rewrite it read "17 behind" both before and after a catch-up that achieved
byte-parity on 9 of 17 files. Either number is noise. Always report **content parity
per file**, never a commit count, and say so explicitly when a stakeholder quotes the
commit number.

## Step 1 — Establish the ground truth

**There is no merge-base.** `git merge-base main upstream/main` exits 1 — the LFS
history rewrite severed all shared history with upstream. If you run it anyway, `B` is
**empty** and every later command silently degrades to upstream's entire history (896
commits), which reads as a catastrophic backlog and is pure noise. The baseline comes
from `.upstream-sync.json` instead.

```bash
# Baseline = last upstream release merged to main. NEVER git merge-base (exits 1 here).
if [ ! -f .upstream-sync.json ]; then
  echo "no .upstream-sync.json — STOP. Do not fall back to git merge-base, and do not"
  echo "trust local vX.Y.Z tags (see below). Ask which upstream tag main last adopted."
  exit 1
fi
B=$(node -p "require('./.upstream-sync.json').sources.ws4kp.sha")
BASE_TAG=$(node -p "require('./.upstream-sync.json').sources.ws4kp.tag")

git fetch upstream --no-tags '+refs/tags/*:refs/upstream-tags/*'
git cat-file -e "$B^{commit}" || { echo "baseline $B missing — fetch failed, or upstream rewrote history"; exit 1; }
[ "$(git rev-parse refs/upstream-tags/$BASE_TAG^{commit})" = "$B" ] \
  || echo "WARNING: upstream moved tag $BASE_TAG off $B — investigate before trusting B"

TARGET=$(git for-each-ref --sort=-v:refname --format='%(refname:short)' 'refs/upstream-tags/v*' | head -1)
git log --oneline $B..$TARGET             # released upstream work since the baseline
git log --oneline $TARGET..upstream/main  # UNRELEASED work — report separately, adopt deliberately
```

Report the released and unreleased ranges separately. The v7.1.6 catch-up correctly
excluded `59defa0`/`7ec5f34` precisely because they were unreleased and touched only
`build-docker.yaml`, a file this fork does not have.

**Baseline record.** `.upstream-sync.json` at the repo root is the only durable record of
what this fork has adopted. It stores upstream-side identifiers only — never a fork commit
SHA, because fork history has been rewritten before and those SHAs die with it (the
`CHANGELOG.md` entry for the 7.1.3 adoption links `f9078ed`, which is now unreachable).
Step 7 updates it. Do **not** infer the baseline from branch names or local tags.

For the code source it also records **why every upstream file that differs here differs**:

- `skipped` — upstream changes deliberately not taken (a sha or a path, one reason each).
- `divergences` — upstream files this fork deliberately changes (`paths` plus a reason).

Read both **before** Step 2: a contested file already listed in `divergences` is a known
fork patch, so the question is only whether upstream's new change still fits around it.

**Local tags are contaminated — do not trust them.** Both repos use release-please and
mint the same `vX.Y.Z` names for *different* commits, so `git fetch upstream --tags`
reports "would clobber existing tag" for the names that collide. But a plain
`git fetch upstream` **auto-follows** any upstream tag whose name the fork has not used
and drops it straight into `refs/tags/` — that is how local `v7.0.0`–`v7.0.4` and `v7.1.6`
came to point at upstream commits (deleted 2026-09-18; they were never on `origin`).
So: always fetch with `--no-tags`, read upstream tags from `refs/upstream-tags/*`, and
never use `git tag`, `git describe`, or a bare `vX.Y.Z` to identify a fork release or the
baseline. Never force-fetch upstream tags into `refs/tags/`.

## Step 2 — Partition the files (this is the whole trick)

**Paths.** The fork keeps the browser app under `web/` (`sources.ws4kp.pathMap` in
`.upstream-sync.json`). Every path in this skill, and every `divergences`/`skipped` entry, is an
**upstream** path; its copy here is that path piped through
`node .claude/skills/upstream-review/path-map.mjs --to-fork`. A plain `git diff $B..main` cannot
pair a moved file with its original, so the fork side of the partition comes from the map-aware
`changed` listing, which also names every file the fork added.

```bash
S="${TMPDIR:-/tmp}"                      # or the session scratchpad
node .claude/skills/upstream-review/path-map.mjs changed $B   | sort > "$S/fork.txt"   # upstream-side paths the fork differs on or added
git diff --no-renames --name-only $B..$TARGET                  | sort > "$S/up.txt"

comm -12 "$S/fork.txt" "$S/up.txt"   # CONTESTED — both sides changed
comm -13 "$S/fork.txt" "$S/up.txt"   # upstream-only — clean apply
```

**`--no-renames` is not optional.** Rename detection lists only the *new* path of a
moved file, so its old path silently drops out of one list and lands in the wrong bucket.
The v8.0.1 review misclassified three files this way: the fork moved `nginx.conf` and
`static-env-handler.sh` into `.archive/static/`, and upstream renamed
`views/partials/radar.ejs` to `radar-common.ejs` — all three read as upstream-only
"clean apply" when they were contested or deleted here.

The upstream-only set applies at the mapped path — the release tag, not `upstream/main`,
unless you are deliberately taking unreleased work — and needs no judgement. Write through a
temp file so a failed `git show` (an upstream deletion) never truncates the fork's copy:

```bash
f=<upstream path>; dest=$(echo "$f" | node .claude/skills/upstream-review/path-map.mjs --to-fork)
if git cat-file -e "$TARGET:$f" 2>/dev/null; then
  tmp=$(mktemp) && git show "$TARGET:$f" > "$tmp" && mkdir -p "$(dirname "$dest")" && mv "$tmp" "$dest"
else
  git rm -q "$dest"                    # upstream deleted it
fi
```

Files **only the fork changed** (`comm -23`) are out of scope. That side of the diff
lists everything the fork has ever diverged on (91 files today); do not read them.

Expect the contested set to be small and mostly boring. The 7.1.3 catch-up had 9 of 17
files upstream-only; the 7.1.4–7.1.6 catch-up had 5 of 8 upstream-only, and the 3
contested files were `package.json`, `package-lock.json` and `README.md` — zero real-code
decisions. For each contested file, look at upstream's hunk first
(`git diff --stat $B $TARGET -- <file>`); if it is a version bump or a README paragraph
the fork rewrote, classify it and move on. Do this partition **before** reading any diffs.

Within the contested set, sort further:

- **Generated** (`server/styles/ws.min.css`, `.map`) — never hand-merge. Take the
  `.scss` source, then `npm run build:css` (from `web/`), and confirm the rule actually compiled.
- **Metadata** (`package.json`, `package-lock.json`) — the fork intentionally runs
  ahead (ejs 6, suncalc 2, eslint 10). Take only specific dependency *additions*
  upstream needs for a file you adopted.
- **Prose** (`README.md`, `docs/`) — the fork rewrote these. Port the *fact*, not the diff.
- **Tests** (`tests/`) — never take upstream's wholesale. `tests/index.mjs` is contested
  and the fork's copy is **11× upstream's** (11.5 KB vs 1.0 KB) — it carries the exit-75
  upstream-outage split that stops a NWS outage failing the pipeline. `tests/unit/` is
  entirely fork-owned; upstream ships no unit tests at all and its `npm test` is still an
  `exit 1` stub. Port an upstream test's *intent* into `tests/unit/`; never `git checkout`
  over `tests/`.
- **Real code** — the only place judgement is required.

## Step 3 — Check whether a "conflict" is actually obsolete

An upstream change to a contested file is often retuning code this fork **deleted**.
Read it before agonising. Real example: upstream's regional-city commit changed
`regionalforecast.mjs`, but the change was `targetDistance 2.4 → 10` and
`targetDist 1 → 1.5` — constants of the selection algorithm this fork replaced
wholesale. Nothing to port.

Conversely, check whether a fork file is byte-identical to the baseline `$B` (`git diff --quiet $B:<upstream path> HEAD:<mapped path>`, or: it is absent from `path-map.mjs changed $B`). If it is,
upstream's fix to it is a **live bug here** and applies cleanly. That is how the
offshore-marine null-grid 404 fix was found.

## Step 4 — Hunt for data/contract hazards (do not skip)

The most dangerous upstream changes are not code conflicts — they are **data format
changes that silently break fork-specific code**. Always:

1. Diff the **shape** of any adopted data file, not just its size. Both feeds live in
   `web/datagenerators/output/`, and they are not the same shape — `regionalcities.json` is an
   **array** of objects with **string** `lat`/`lon`; `stations.json` is an **object keyed by
   station id** with **number** `lat`/`lon`. Check `Array.isArray` before indexing, or
   `a[0].lat` prints `undefined` and you have "checked" nothing:
   ```bash
   node -e "const a=require('./web/datagenerators/output/regionalcities.json'); console.log(Array.isArray(a), typeof a[0].lat)"
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
import { selectRegionalCities } from './web/server/scripts/modules/regionalforecast-select.mjs';
// build the pool both ways and print the counts
"
```

## Step 5 — Decide, and put the decision to the user

For each contested item classify as: **adopt**, **already have it**, **obsolete for this
fork**, or **conflicts with a deliberate fork feature**. Only the last needs a decision,
and it is the user's — present it with a recommendation and the trade-off, don't just pick.

**Every adopted real-code fix gets a test verdict.** For each one, check whether upstream
shipped tests with it (`git show --stat <sha>` — look for anything under `tests/`). If it
did, review those tests and port their intent into `tests/unit/`. If it did not — the usual
case, since upstream has no unit suite — decide explicitly whether the fix needs one, and
**say which you chose in the report**. A fix landing untested is a decision, not a default.
Adopting at byte-parity means adopting upstream's test coverage too, which is zero.

Standing decisions (do not silently reverse):

- The fork **owns its test suite**. All of `tests/unit/` is fork-only; upstream has no unit
  tests to inherit. Regressions in adopted code are caught here or nowhere.

- The fork keeps its **density-aware regional selection** (`regionalforecast-select.mjs`)
  over upstream's fixed-pixel AABB. It measures real rendered boxes and scales to
  portrait/wide. Take upstream's *correctness* fixes into that structure instead.
- The fork's CI is a **single composed `ci.yaml`**; upstream has none.
- Version/tag lineage is independent.
- **Deleted-here files stay deleted.** A file this fork removed on purpose still exists
  upstream, so it lands in the *upstream-only* bucket and looks like a clean apply — the
  partition cannot tell "we never had it" from "we deleted it". Before applying that
  bucket, check each path against `main` and skip anything the fork dropped deliberately.
  Currently: `ws4kp.code-workspace` (removed 2026-09-18, duplicated `.vscode/`),
  `.github/workflows/build-docker.yaml` (this fork composes its own `ci.yaml`),
  `Dockerfile.server`, and `nginx.conf` + `static-env-handler.sh` (static mode archived
  to `.archive/static/`). Record
  each one in `sources.ws4kp.skipped` so it is not re-litigated.
- **Every fork change to an upstream file is recorded.** When a review (or any other
  work) changes a file that exists upstream, add it to `sources.ws4kp.divergences` with a
  reason in the same PR. Prefer a fork-owned file over editing an upstream one — new
  modules, and fork-owned SCSS partials (`_custom-logo`, `_current-weather-icon`,
  `_list-text`) that restyle upstream markup without touching upstream's partials —
  so the list stays short and each entry is a real decision.

## Step 6 — Package by risk

Split into separate PRs when risk profiles differ; fold trivia into the open PR:

- **Low risk** — files the fork never touched, data, generated CSS, isolated guards.
- **Needs eyes** — anything that changes rendering, selection, or layout.

## Step 7 — Verify like you mean it

- `npm run test:unit` (from `web/`) — the CI-relevant suite. It includes
  `tests/unit/build-consistency.test.mjs`, which fails if `server/styles/ws.min.css` is not
  a byte-match for a fresh compile — so a forgotten `npm run build:css` (from `web/`) after adopting an
  upstream `.scss` fails the unit suite, not just review.
- `rtk proxy npm run lint` (from `web/`) — raw/uncached. Since v8 it is `eslint .` with upstream's flat
  config, which ignores `tests/`. Compare against clean `main` before blaming your change.
- Integration test (Puppeteer, 5 cities, live NWS) — what `ci-test.yml` runs:
  ```bash
  npm ci --prefix web/tests        # web/tests/ is its own npm package (puppeteer, chalk)
  (cd web && WS4KP_PORT=8136 node index.mjs > "${TMPDIR:-/tmp}/ws4kp.log" 2>&1 &)
  until curl -sf http://localhost:8136/ >/dev/null; do node -e "setTimeout(()=>{},500)"; done
  WS4KP_TEST_URL=http://localhost:8136 node web/tests/index.mjs; echo "exit=$?"
  pkill -f "node index.mjs"
  ```
  Exit **0** = clean, **1** = a real regression, **75** = api.weather.gov / Open-Meteo was
  down, i.e. inconclusive, *not* a failure. `WS4KP_PORT`, not `PORT`. Neither `timeout` nor
  `gtimeout` exists on this box, and the harness blocks foreground `sleep` — hence the
  `node -e setTimeout` stand-in.
- `npm run build:css` (from `web/`) after any `.scss` change, then grep the minified output for the
  compiled rule.
- **Rendering changes require a browser.** Unit tests did not catch that decluttering
  was a silent no-op. See `.claude/skills/upstream-review/browser-verify.md`.
- **Bump `sources.ws4kp`** to the upstream tag you reached parity with: `tag`, `sha`
  from `git rev-parse refs/upstream-tags/<tag>^{commit}`, `adopted` = today, `pr` = the PR
  number, `skipped` = in-range upstream changes deliberately not taken, one reason each, so
  the next run does not re-litigate them, and `divergences` updated for every fork patch.
  Put the bump in the **same commit** as the adopted files (or the last commit of a
  multi-commit PR) — the marker is the assertion and the files are the evidence; split
  them and one can land without the other.
- **Run the parity check** against the new baseline:
  ```bash
  node .claude/skills/upstream-review/parity-check.mjs
  ```
  It fails on any upstream file that differs here without a `divergences` or `skipped`
  entry (unexplained drift), and on any `divergences` entry that now matches upstream
  byte-for-byte (stale). Exit 0 is the definition of parity; until then, do not bump the
  marker. Report its counts ("47 upstream files differ, 47 explained").

## Music source (ws4kp-music)

`netbymatt/ws4kp-music` holds the tracks this fork bundles in `web/server/music/default`,
organised as album folders. It has **no release tags**, so its baseline is a commit on
`main` (`sources.ws4kp-music.sha`), and adoption is tracked **per album** under `albums`:
`status` (adopted / skipped), `tracks`, `license`, `source`, and any `renamed` files.

```bash
M=$(node -p "require('./.upstream-sync.json').sources['ws4kp-music'].sha")
# what changed since the baseline
gh api "repos/netbymatt/ws4kp-music/compare/$M...main" --jq '"ahead by \(.ahead_by)", (.files[] | "\(.status)\t\(.filename)")'
# album folders at main, to spot a new album
gh api "repos/netbymatt/ws4kp-music/git/trees/main" --jq '.tree[] | select(.type=="tree") | .path'
```

Classify each change by album:

- **A new album folder** is a decision for the user. Read the repo's README license table
  first: the albums are **not** all licensed alike (Latest Observations is CC BY 4.0;
  Current Conditions and Holiday are owned by Suno, non-commercial only), and that decides
  whether it may ship and what credit it needs. Seasonal albums (Holiday) would play
  year-round — the playlist reader has no scheduling.
- **A changed track in an adopted album** — compare duration, bitrate and tags with
  `music-metadata` before taking it. Current Conditions here is deliberately *not* the
  repo's copy: the user chose to keep the 192 kbps originals over the repo's 128 kbps
  re-encodes (its `decision`), so differences in that folder are expected, not drift.
- **A README or LICENSE change** — re-check the license table and the credit lines.

Adopting tracks:

1. Pin to a commit: download from `raw.githubusercontent.com/netbymatt/ws4kp-music/<sha>/…`,
   never `main`.
2. Verify every file byte-for-byte: its git blob hash, `sha1("blob <len>\0" + bytes)`,
   must equal the tree entry's `sha`.
3. Read the tags (`music-metadata`): the player shows the title/artist tags, falling back
   to the file name.
4. Flatten into `web/server/music/default`: the reader scans only `web/server/music` and falls back
   to `web/server/music/default`, with no subfolders. Name each file `<album>--<song>.mp3`, all lower
   case, with every space a single dash (`sources.ws4kp-music.naming`); the album prefix keeps same-named
   songs apart (both albums have *Rolling Clouds*).
5. Stage and confirm Git LFS took them (`git show :<path>` prints a pointer, not audio).
6. Credit any license that needs it in `README.md` and `docs/music.md`, and keep those
   docs' description of what ships accurate.
7. Rebuild the Docker image, compare its size, and check `/playlist.json` lists the tracks
   and `/music/…` serves them.
8. Bump `sources.ws4kp-music`: `sha`, `adopted`, `pr`, and the album entries.

Shell note: in zsh, `path` is tied to `$PATH`. Naming a loop variable `path` (as in
`while read -r sha size path`) wipes the command search path mid-loop.

## Reporting

Report each source separately. For the code: lead with what is contested and what it costs — not a commit count. Give a table of
upstream fixes with whether each applies clean, call out anything that is a live bug in
this fork, and state the one or two genuine decisions plainly with a recommendation.

Every adopted real-code fix carries its **test status** in that table — ported from
upstream / test written here / accepted untested. "Accepted untested" is a legitimate
answer, but it must be visible; it must never be what happens when nobody asked.
