# Execution Kickoff Prompt

Paste the block below as the opening message of a fresh Claude Code session (working directory: `/Users/acaudill/Projects/github/forks/ws4kp`). Treat the agent as having no prior context.

---

Execute the implementation plan at:

```
docs/plans/2026-05-24-regional-forecast-density-implementation.md
```

The plan contains the full task breakdown (T1, T2, T3) and the mandatory execution workflow in its header. Follow that workflow exactly — do not improvise the process.

## Context you need

- **Repo:** `/Users/acaudill/Projects/github/forks/ws4kp` — jacaudi's fork of `netbymatt/ws4kp` v7.0.0. Framework-free WeatherStar 4000 web app (ES6 modules, Express server, Gulp+Webpack build, NWS API).
- **GitHub issue this addresses:** [jacaudi/ws4kp#1](https://github.com/jacaudi/ws4kp/issues/1). Your PR must reference it.
- **Design rationale:** `docs/plans/2026-05-24-regional-forecast-density-design.md`. Read this before starting T2 so you understand why the algorithm is shaped the way it is.
- **Validation tool:** `docs/_review-chunks/regional-preview.html`. Open directly in a browser (no server needed; everything is inlined). Renders the algorithm's output on real geography (Leaflet + OpenStreetMap tiles via CARTO). Use it to sanity-check T2's behavior against the design.

## Non-negotiable constraints

1. **Minimal changes only.** Don't refactor surrounding code. Don't add abstractions. Don't be clever. Implement exactly what the plan calls for and nothing more. The user explicitly asked for this — they want low merge-friction with upstream `netbymatt/ws4kp`.
2. **No state-specific or city-specific names** in any user-facing artifact (PR body, commit messages, code comments, screenshot captions). Use generic descriptors ("northwestern US," "central plains," "southeastern US") instead.
3. **Basemap projection mismatch is OUT OF SCOPE.** Do not touch `getXYFromLatLon`, `getMinMaxLatitudeLongitude`, or `basemap.webp`. Markers may appear slightly off the basemap — that's a known pre-existing condition, tracked separately.
4. **No test infrastructure exists.** For T1 (2-line return fix) and T2 (algorithm) adding small unit tests for the pure helpers (cell math, user-exclusion guard, distance) is reasonable; manual verification is the primary signal for T3. Document any tests added and any manual steps run in each subagent's verification report.
5. **Do not modify `package.json`** to add a test runner or any new dependency. If you write tests, they should be standalone scripts in `tests/` (which already has its own `package.json`) or runnable with Node's built-in `node --test`.

## Workflow recap (already mandated by the implementation plan's header — listed here for convenience)

1. Create an isolated git worktree before any code changes.
2. Dispatch one fresh subagent per task. Brief each with TDD requirements.
3. Verify each task before marking complete (`superpowers:verification-before-completion`).
4. After T1, T2, and T3 are all done, run a comprehensive review on the full branch diff via a fresh, non-context-sharing review subagent.
5. Address review findings before proceeding.
6. Use `superpowers:finishing-a-development-branch` to open the PR.

## PR requirements

- Target branch: `main` on `jacaudi/ws4kp`.
- Title and body reference issue #1 (e.g., "Closes #1").
- Body summarizes the change but does not duplicate the design/plan docs — reference their paths under `docs/plans/`.
- Body includes before/after screenshots from T3's manual verification (generic captions — do not name specific locations).
- Commit the three `docs/plans/2026-05-24-regional-forecast-density-{design,implementation,execute-prompt}.md` files in the first commit of the branch (they exist in the working tree as untracked files today).

## When you finish

Add observations to the Memory MCP entity `ws4kp-weatherstar-4000` documenting any non-obvious decisions made during execution (test locations used, deviations from the plan and why, surprises encountered). Also leave a brief Claude Memory note under `project_regional_forecast_density.md` flipping its status from "Ready to execute" to "Merged" with the PR link.

GO.

---

## Notes for the human launching this

- The implementation plan's header already declares the full skill chain; the prompt above just reinforces it.
- If the agent gets stuck and needs to ask a question, the most likely sticking points are (a) test placement convention, (b) whether to bundle the `docs/plans/` commit with the AK/HI fix (yes, see PR requirements) or separately, and (c) screenshot tooling for T3. Defaults: standalone scripts under `tests/`, bundle the docs, use the live `npm start` and a browser screenshot tool.
- If the agent proposes scope expansion (refactoring nearby code, "while we're here" cleanups, adding caching), redirect to the minimal-change rule.
