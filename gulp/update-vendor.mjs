import {
	existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

const vendorDir = './server/scripts/vendor/auto';

// Single source of truth for what gets vendored and the filename it ships under.
// tests/unit/build-consistency.test.mjs reads this same list to assert the committed
// tree matches node_modules, so the guard cannot drift from the task that writes it.
export const vendorManifest = [
	{ source: './node_modules/luxon/build/es6/luxon.mjs', dest: 'luxon.mjs' },
	{ source: './node_modules/luxon/build/es6/luxon.mjs.map', dest: 'luxon.mjs.map' },
	{ source: './node_modules/@zakj/no-sleep/dist/no-sleep.js', dest: 'no-sleep.js' },
	// suncalc v2 dropped suncalc.js; .cjs is its UMD build, the one a <script> tag needs.
	// It lands as .js because a .cjs extension is served with a non-JavaScript MIME type.
	{ source: './node_modules/suncalc/suncalc.cjs', dest: 'suncalc.js' },
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

const updateVendor = async () => {
	// Verify every source before touching the vendored tree. This task used to delete
	// the tree first and copy second, so a package that stopped shipping a file left
	// the tree deleted rather than failing -- which is exactly what happened when
	// suncalc v2 dropped suncalc.js.
	const missing = vendorManifest.map(({ source }) => source).filter((source) => !existsSync(source));
	if (missing.length > 0) {
		throw new Error(`vendor sources missing from node_modules; refusing to modify ${vendorDir}: ${missing.join(', ')}`);
	}

	// Read everything up front for the same reason: a read that throws must not leave a
	// half-written tree behind.
	const files = vendorManifest.map(({ source, dest }) => ({
		dest,
		contents: normalizeVendorText(readFileSync(source, 'utf8')),
	}));

	// Replace rather than merge, so a file dropped from the manifest stops shipping.
	rmSync(vendorDir, { recursive: true, force: true });
	files.forEach(({ dest, contents }) => {
		const target = path.join(vendorDir, dest);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, contents);
	});
};

export default updateVendor;
