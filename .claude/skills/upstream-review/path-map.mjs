// Maps file paths between the code upstream (netbymatt/ws4kp) and this fork, using
// sources.ws4kp.pathMap in .upstream-sync.json. Entries are tried in order; a `from`/`to`
// ending in "/" is a prefix, anything else an exact path. The first match wins, and an
// unmatched path maps to itself.
//
// The fork keeps the browser app and its Node toolchain under web/, so
// `git diff <upstream> HEAD` can no longer pair a moved file with its upstream original.
// The functions below compare blobs through the map instead.
//
//   node .claude/skills/upstream-review/path-map.mjs --to-fork     < upstream-paths
//   node .claude/skills/upstream-review/path-map.mjs --to-upstream < fork-paths
//   node .claude/skills/upstream-review/path-map.mjs changed <upstream-ref>
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const matches = (key, file) => (key.endsWith('/') ? file.startsWith(key) : file === key);

const mapWith = (pathMap, file, fromKey, toKey) => {
	const entry = pathMap.find((e) => matches(e[fromKey], file));
	if (!entry) return file;
	return entry[fromKey].endsWith('/') ? `${entry[toKey]}${file.slice(entry[fromKey].length)}` : entry[toKey];
};

export const toFork = (pathMap, file) => mapWith(pathMap, file, 'from', 'to');
export const toUpstream = (pathMap, file) => mapWith(pathMap, file, 'to', 'from');

// path -> "<mode> <blob oid>" for every file in a tree-ish; -z so paths are never quoted
const treeEntries = async (ref, cwd) => {
	const { stdout } = await run('git', ['ls-tree', '-r', '-z', '--full-tree', ref], { cwd, maxBuffer: 64 * 1024 * 1024 });
	return new Map(stdout.split('\0').filter(Boolean).map((line) => {
		const tab = line.indexOf('\t');
		const [mode, , oid] = line.slice(0, tab).split(' ');
		return [line.slice(tab + 1), `${mode} ${oid}`];
	}));
};

// Upstream paths whose fork counterpart is missing at HEAD or is not byte-identical (same
// mode and blob): what `git diff --no-renames <upstream> HEAD` reported, paired through the map.
export const differingFiles = async (upstreamRef, pathMap, { cwd = process.cwd() } = {}) => {
	const [upstream, fork] = await Promise.all([treeEntries(upstreamRef, cwd), treeEntries('HEAD', cwd)]);
	return [...upstream]
		.filter(([file, entry]) => fork.get(toFork(pathMap, file)) !== entry)
		.map(([file]) => file)
		.sort();
};

// Fork files with no upstream counterpart, named by their upstream-side path: the files the
// fork added. A later upstream file at one of these paths is contested, never a clean apply.
export const forkOnlyFiles = async (upstreamRef, pathMap, { cwd = process.cwd() } = {}) => {
	const [upstream, fork] = await Promise.all([treeEntries(upstreamRef, cwd), treeEntries('HEAD', cwd)]);
	return [...fork.keys()]
		.map((file) => toUpstream(pathMap, file))
		.filter((file) => !upstream.has(file))
		.sort();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [mode, ref] = process.argv.slice(2);
	const { sources } = JSON.parse(await readFile('.upstream-sync.json', 'utf8'));
	const pathMap = sources.ws4kp.pathMap ?? [];
	if (mode === 'changed' && ref) {
		// every upstream-side path the fork differs on, additions included (the old `git diff $B..main`)
		const changed = new Set([...await differingFiles(ref, pathMap), ...await forkOnlyFiles(ref, pathMap)]);
		[...changed].sort().forEach((file) => console.log(file));
	} else if (mode === '--to-fork' || mode === '--to-upstream') {
		const map = mode === '--to-fork' ? toFork : toUpstream;
		(await text(process.stdin)).split('\n').filter(Boolean).forEach((file) => console.log(map(pathMap, file)));
	} else {
		console.error('usage: path-map.mjs --to-fork | --to-upstream  (paths on stdin)\n       path-map.mjs changed <upstream-ref>');
		process.exitCode = 2;
	}
}
