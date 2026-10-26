import {
	access, mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import webpack from 'webpack';

const vendorDir = './server/scripts/vendor/auto';

// Single source of truth for what gets vendored and the filename it ships under.
// tests/unit/build-consistency.test.mjs reads this same list to assert the committed
// tree matches node_modules, so the guard cannot drift from the task that writes it.
export const vendorManifest = [
	{ source: './node_modules/luxon/build/es6/luxon.mjs', dest: 'luxon.mjs' },
	{ source: './node_modules/luxon/build/es6/luxon.mjs.map', dest: 'luxon.mjs.map' },
	{ source: './node_modules/@zakj/no-sleep/dist/no-sleep.js', dest: 'no-sleep.js' },
	// the app imports suncalc's named ES exports, so ship its ES module entry (it imports nothing)
	{ source: './node_modules/suncalc/index.js', dest: 'suncalc.js' },
	{ source: './node_modules/swiped-events/src/swiped-events.js', dest: 'swiped-events.js' },
	// Loaded as an ES module here, so it ships as .mjs despite the package's .js name.
	{ source: './node_modules/metar-taf-parser/metar-taf-parser.js', dest: 'metar-taf-parser.mjs' },
	// Only the English locale is used; the rest of locale/ is not vendored.
	{ source: './node_modules/metar-taf-parser/locale/en.js', dest: 'locale/en.js' },
];

// .gitattributes stores every .js/.mjs with `eol=lf`, but metar-taf-parser ships 33
// CRLF lines. Copying verbatim leaves that file permanently dirty in `git status`
// while `git diff` shows nothing, because git normalizes line endings on checkin.
// Normalizing here is what makes the vendored tree match what git actually stores.
export const normalizeVendorText = (text) => text.replace(/\r\n/g, '\n');

// proj4 is not copied but built, with only the projections the app uses (see gulp/proj4-minimal.mjs).
// The result is a plain script that sets the proj4 global, the same as proj4's own browser build.
export const PROJ4_DEST = 'proj4.js';
export const buildProj4 = (outDir) => new Promise((resolve, reject) => {
	webpack({
		mode: 'production',
		entry: './gulp/proj4-minimal.mjs',
		output: {
			path: path.resolve(outDir),
			filename: PROJ4_DEST,
		},
		devtool: false,
		performance: { hints: false },
	}, (err, stats) => {
		if (err) {
			reject(err);
			return;
		}
		if (stats.hasErrors()) {
			reject(new Error(stats.toString('errors-only')));
			return;
		}
		resolve(path.join(outDir, PROJ4_DEST));
	});
});

const updateVendor = async () => {
	// Verify every source before touching the vendored tree. This task used to delete
	// the tree first and copy second, so a package that stopped shipping a file left
	// the tree deleted rather than failing -- which is exactly what happened when
	// suncalc v2 dropped suncalc.js.
	const present = await Promise.all(vendorManifest.map(({ source }) => access(source).then(() => true, () => false)));
	const missing = vendorManifest.map(({ source }) => source).filter((source, index) => !present[index]);
	if (missing.length > 0) {
		throw new Error(`vendor sources missing from node_modules; refusing to modify ${vendorDir}: ${missing.join(', ')}`);
	}

	// Read everything up front for the same reason: a read that throws must not leave a
	// half-written tree behind.
	const files = await Promise.all(vendorManifest.map(async ({ source, dest }) => ({
		dest,
		contents: normalizeVendorText(await readFile(source, 'utf8')),
	})));
	// build proj4 outside the vendored tree, so a failed build leaves the tree untouched too
	const buildDir = await mkdtemp(path.join(tmpdir(), 'ws4kp-proj4-'));
	try {
		files.push({ dest: PROJ4_DEST, contents: await readFile(await buildProj4(buildDir), 'utf8') });
	} finally {
		await rm(buildDir, { recursive: true, force: true });
	}

	// Replace rather than merge, so a file dropped from the manifest stops shipping.
	await rm(vendorDir, { recursive: true, force: true });
	await Promise.all(files.map(async ({ dest, contents }) => {
		const target = path.join(vendorDir, dest);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, contents);
	}));
};

export default updateVendor;
