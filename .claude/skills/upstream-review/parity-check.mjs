// Parity check for the code upstream (sources.ws4kp in .upstream-sync.json).
//
// Every upstream file that differs here must be explained: listed under `divergences` (a change
// this fork makes on purpose) or `skipped` (an upstream change not taken). Anything else is
// unexplained drift, and the review is not finished.
//
// Also flags stale entries: a divergence whose files now match upstream byte-for-byte should be
// removed, or the list stops meaning anything.
//
// Upstream files are paired with their fork copies through sources.ws4kp.pathMap (the fork keeps
// the browser app under web/); divergences and skipped are keyed by UPSTREAM path. The check
// compares against the COMMITTED tree (HEAD): commit before running it.
//
// Run from the repo root after SKILL.md Step 1 has fetched upstream tags:
//   node .claude/skills/upstream-review/parity-check.mjs
// Exit 0 = every difference explained, 1 = unexplained or stale entries (listed on stdout).
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { differingFiles } from './path-map.mjs';

const run = promisify(execFile);
const git = async (...args) => (await run('git', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

const { sources } = JSON.parse(await readFile('.upstream-sync.json', 'utf8'));
const source = sources.ws4kp;
const upstreamRef = `refs/upstream-tags/${source.tag}`;

const resolved = (await git('rev-parse', `${upstreamRef}^{commit}`)).trim();
if (resolved !== source.sha) {
	throw new Error(`${upstreamRef} is ${resolved}, but .upstream-sync.json records ${source.sha}; fix the baseline first`);
}

const differing = await differingFiles(upstreamRef, source.pathMap ?? []);

const divergent = new Set(source.divergences.flatMap((d) => d.paths));
const skipped = new Set(source.skipped.filter((s) => s.path).map((s) => s.path));

const unexplained = differing.filter((file) => !divergent.has(file) && !skipped.has(file));
const stale = [...divergent].filter((file) => !differing.includes(file));

console.log(`${differing.length} upstream files differ from ${source.tag}: ${differing.length - unexplained.length} explained`);
if (unexplained.length) console.log(`\nunexplained (add to divergences with a reason, or revert to upstream):\n  ${unexplained.join('\n  ')}`);
if (stale.length) console.log(`\nstale divergences (now identical to upstream; remove them):\n  ${stale.join('\n  ')}`);
if (unexplained.length || stale.length) process.exitCode = 1;
