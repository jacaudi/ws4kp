// Type-check ratchet: `tsc --checkJs` over the browser code and the Node code, gated on the
// per-file, per-error-code counts in tsc-baseline.json rather than on zero errors. The JS predates
// type checking, so it starts with debt; the ratchet lets that debt only go down.
//
//   npm run typecheck                fails if any (file, code) count rises or a new pair appears
//   npm run typecheck -- --update    rewrites tsc-baseline.json to the current counts
//
// Use --update only in a commit whose message says why: a TypeScript or @types/node bump, a
// vendored-package bump, a file rename, or debt paid down (docs/development.md). Diagnostics under server/scripts/vendor/ are
// dropped: checkJs checks every file an included file imports, and Renovate regenerates those.
import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = fileURLToPath(new URL('../tsc-baseline.json', import.meta.url));
const tscPath = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CONFIGS = ['tsconfig.browser.json', 'tsconfig.node.json'];
const VENDOR = 'server/scripts/vendor/';
const DIAGNOSTIC = /^(.+)\(\d+,\d+\): error (TS\d+): /;

// tsc --pretty false prints one `path(line,col): error TSnnnn: message` line per diagnostic, and
// indented continuation lines under some of them. A diagnostic with no file (a broken tsconfig, no
// inputs) would otherwise count as nothing and pass, so it throws.
export const parseDiagnostics = (output) => output.split('\n').reduce((counts, line) => {
	if (/^error TS\d+/.test(line)) throw new Error(`tsc reported an error outside any file: ${line}`);
	const match = DIAGNOSTIC.exec(line);
	if (!match) return counts;
	const [, file, code] = match;
	if (file.startsWith(VENDOR)) return counts;
	const forFile = counts[file] ?? {};
	return { ...counts, [file]: { ...forFile, [code]: (forFile[code] ?? 0) + 1 } };
}, {});

export const mergeCounts = (a, b) => Object.entries(b).reduce((merged, [file, codes]) => ({
	...merged,
	[file]: Object.entries(codes).reduce((forFile, [code, n]) => ({ ...forFile, [code]: (forFile[code] ?? 0) + n }), { ...merged[file] }),
}), a);

export const totalOf = (counts) => Object.values(counts)
	.flatMap((codes) => Object.values(codes))
	.reduce((sum, n) => sum + n, 0);

const pairs = (counts) => Object.entries(counts)
	.flatMap(([file, codes]) => Object.entries(codes).map(([code, n]) => ({ file, code, n })));

// raised: a count above its baseline, or a pair the baseline does not have (fails the check).
// lowered: a count below its baseline, or a baseline pair that is gone (the baseline can shrink).
export const compareCounts = (current, baseline) => ({
	raised: pairs(current)
		.filter(({ file, code, n }) => n > (baseline[file]?.[code] ?? 0))
		.map(({ file, code, n }) => ({
			file, code, was: baseline[file]?.[code] ?? 0, now: n,
		})),
	lowered: pairs(baseline)
		.filter(({ file, code, n }) => n > (current[file]?.[code] ?? 0))
		.map(({ file, code, n }) => ({
			file, code, was: n, now: current[file]?.[code] ?? 0,
		})),
});

const sorted = (counts) => Object.fromEntries(Object.keys(counts).sort().map((file) => [
	file,
	Object.fromEntries(Object.keys(counts[file]).sort().map((code) => [code, counts[file][code]])),
]));

const run = promisify(execFile);

// tsc exits 2 when it reports diagnostics, which execFile turns into a rejection carrying stdout.
const tscOutput = async (config) => {
	try {
		return (await run(process.execPath, [tscPath, '-p', config, '--noEmit', '--pretty', 'false'], { cwd: webDir, maxBuffer: 64 * 1024 * 1024 })).stdout;
	} catch (error) {
		if (typeof error.stdout === 'string' && error.code === 2) return error.stdout;
		throw error;
	}
};

const main = async () => {
	const outputs = await Promise.all(CONFIGS.map(tscOutput));
	const current = outputs.map(parseDiagnostics).reduce(mergeCounts, {});

	if (process.argv.includes('--update')) {
		await writeFile(baselinePath, `${JSON.stringify(sorted(current), null, '\t')}\n`);
		console.log(`tsc-baseline.json updated: ${totalOf(current)} diagnostics in ${Object.keys(current).length} files`);
		return;
	}

	const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
	const { raised, lowered } = compareCounts(current, baseline);
	console.log(`tsc ratchet: ${totalOf(current)} diagnostics, baseline ${totalOf(baseline)}`);
	if (raised.length) {
		console.error('new type errors (fix them; --update is only for the reasons in docs/development.md):');
		raised.forEach(({
			file, code, was, now,
		}) => console.error(`  ${file} ${code}: baseline ${was}, now ${now}`));
		process.exitCode = 1;
		return;
	}
	if (lowered.length) console.log('tsc baseline can be lowered: run npm run typecheck -- --update');
};

// Run only as a script, not when the unit tests import the functions above. realpath, because
// Node resolves the entry module through symlinks but leaves process.argv[1] as typed.
if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) await main();
