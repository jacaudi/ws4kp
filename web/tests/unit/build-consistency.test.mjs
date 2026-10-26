// Guards against build-artifact drift: hand-maintained lists and committed
// generated files silently falling out of step with their real source.
//
// Two bugs of this shape have shipped. The Air Quality display was missing from
// every production build because airquality.mjs was never added to the webpack
// entry list, and the committed ws.min.css went stale because the script that
// regenerates it was broken. Both were invisible until someone looked at the
// right deployment mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	existsSync, mkdtempSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as sass from 'sass';
import {
	vendorManifest, normalizeVendorText, buildProj4, PROJ4_DEST,
} from '../../gulp/update-vendor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

// The authoritative list of displays is the code, not any config file: a display
// is any module that registers itself with navigation at import time. Every
// registration is a top-level statement, which is why the anchor is safe -- it
// also keeps navigation.mjs (which defines registerDisplay) out of the results.
const registeredDisplays = () => {
	const dir = path.join(repoRoot, 'server/scripts/modules');
	const found = readdirSync(dir)
		.filter((file) => file.endsWith('.mjs'))
		.map((file) => ({ file, source: readFileSync(path.join(dir, file), 'utf8') }))
		.map(({ file, source }) => ({ file, registration: source.match(/^registerDisplay\(new \w+\((\d+),/m) }))
		.filter(({ registration }) => registration)
		.map(({ file, registration }) => ({ file, navId: Number(registration[1]) }))
		.sort((a, b) => a.file.localeCompare(b.file));

	// A zero-length scan would make every assertion below vacuously true.
	assert.ok(found.length > 0, 'found no modules calling registerDisplay(); the scan is broken, not the config');
	return found;
};

// Dev (views/index.ejs) and production (gulp/build.mjs) both load one entry point,
// server/scripts/ws.mjs, so a module it does not import never executes and never
// registers -- in every deployment mode at once.
const wsImports = () => {
	const imports = [...read('server/scripts/ws.mjs').matchAll(/^import '\.\/modules\/([\w.-]+\.mjs)';/gm)].map(([, file]) => file);
	assert.ok(imports.length > 0, 'found no module imports in server/scripts/ws.mjs; the parse is broken, not the config');
	return imports;
};

test('both deployment modes load ws.mjs as their single entry point', () => {
	assert.match(read('gulp/build.mjs'), /'\.\/server\/scripts\/ws\.mjs'/, 'gulp/build.mjs no longer bundles server/scripts/ws.mjs; update this test to match the new shape');
	assert.match(read('views/index.ejs'), /src="scripts\/ws\.mjs"/, 'views/index.ejs no longer loads scripts/ws.mjs in development; update this test to match the new shape');
});

test('every registered display is imported by ws.mjs', () => {
	const imported = wsImports();
	const missing = registeredDisplays().map(({ file }) => file).filter((file) => !imported.includes(file));
	assert.deepEqual(missing, [], `missing from server/scripts/ws.mjs, so absent from every build: ${missing.join(', ')}`);
});

// navigation stores displays by nav ID, so a second display on the same ID silently
// replaces the first. Upstream v8 gave Future Radar ID 12, which Air Quality already used.
test('every registered display has a unique nav ID', () => {
	const byId = Map.groupBy(registeredDisplays(), ({ navId }) => navId);
	const clashes = [...byId].filter(([, displays]) => displays.length > 1)
		.map(([navId, displays]) => `${navId}: ${displays.map(({ file }) => file).join(' + ')}`);
	assert.deepEqual(clashes, [], `displays sharing a nav ID, only the last to load survives: ${clashes.join('; ')}`);
});

// The vendored copies under server/scripts/vendor/auto/ are what actually ship --
// views/index.ejs loads them by <script> tag and gulp concatenates them into
// vendor.min.js -- so the committed file, not the npm package, is the running code.
// Drift here means the declared dependency version and the shipped code disagree.
test('every vendored file matches the package the lockfile installs', () => {
	assert.ok(vendorManifest.length > 0, 'vendorManifest is empty; the manifest is broken, not the vendored tree');

	const stale = vendorManifest
		.filter(({ source, dest }) => {
			const expected = normalizeVendorText(read(source));
			return read(path.join('server/scripts/vendor/auto', dest)) !== expected;
		})
		.map(({ dest }) => dest);

	assert.deepEqual(stale, [], `out of step with node_modules; run \`npx gulp updateVendor\` and commit the result: ${stale.join(', ')}`);
});

// proj4 is built rather than copied, so the comparison is against a fresh build. The
// build is deterministic: it reproduces upstream's committed proj4.js byte for byte.
test('vendored proj4.js matches a fresh build of the installed proj4', async () => {
	const buildDir = mkdtempSync(path.join(tmpdir(), 'ws4kp-proj4-test-'));
	try {
		const fresh = readFileSync(await buildProj4(buildDir), 'utf8');
		assert.equal(read(path.join('server/scripts/vendor/auto', PROJ4_DEST)), fresh, 'proj4.js is out of step with node_modules; run `npx gulp updateVendor` and commit the result');
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

// updateVendor used to delete the whole vendored tree before copying, so a package
// that stopped shipping a file left the tree empty rather than failing. That happened
// with suncalc v2 dropping suncalc.js.
test('every vendored source path still exists in node_modules', () => {
	const missing = vendorManifest
		.map(({ source }) => source)
		.filter((source) => !existsSync(path.join(repoRoot, source)));

	assert.deepEqual(missing, [], `vendor sources missing from node_modules -- the package layout changed and the manifest needs updating: ${missing.join(', ')}`);
});

test('committed ws.min.css matches a fresh compile of ws.scss', () => {
	// The CLI appends this when it writes the companion map; the JS API does not.
	const committed = read('server/styles/ws.min.css').replace(/\/\*# sourceMappingURL=.*?\*\/\s*$/, '').trim();
	const fresh = sass.compile(path.join(repoRoot, 'server/styles/scss/ws.scss'), { style: 'compressed' }).css.trim();

	assert.equal(committed, fresh, 'server/styles/ws.min.css is stale; run `npm run build:css` and commit the result');
});

// The Go server (internal/server/render.go) finds these markers in the built index and
// rewrites what sits between them on every request: the server flag, the runtime OVERRIDES
// (one per production/development branch) and the kiosk class on the first <body. A template
// edit that drops or duplicates one silently breaks that feature in server mode.
test('views/index.ejs carries each marker the Go server rewrites, as often as it expects', () => {
	const template = read('views/index.ejs');
	const expected = {
		'<!--ws4kp:server-->': 1,
		'<!--/ws4kp:server-->': 1,
		'/*ws4kp:overrides*/': 2,
		'/*/ws4kp:overrides*/': 2,
		'<body': 1,
	};
	const found = Object.fromEntries(Object.keys(expected).map((marker) => [marker, template.split(marker).length - 1]));
	assert.deepEqual(found, expected);
});
