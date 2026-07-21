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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as sass from 'sass';

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
		.filter((file) => /^registerDisplay\(/m.test(readFileSync(path.join(dir, file), 'utf8')))
		.sort();

	// A zero-length scan would make every assertion below vacuously true.
	assert.ok(found.length > 0, 'found no modules calling registerDisplay(); the scan is broken, not the config');
	return found;
};

// Production loads prebuilt bundles, so a display missing here is absent from
// every DIST=1 deployment no matter how correct the module itself is.
const gulpDisplayEntries = () => {
	const block = read('gulp/build.mjs').match(/displays:\s*\{\s*import:\s*\[([\s\S]*?)\]/);
	assert.ok(block, 'could not locate entry.displays.import in gulp/build.mjs; update this test to match the new shape');

	const entries = [...block[1].matchAll(/modules\/([\w.-]+\.mjs)/g)].map(([, file]) => file);
	assert.ok(entries.length > 0, 'parsed entry.displays.import as empty; the parse is broken, not the config');
	return entries;
};

// Development loads each module directly rather than the bundles.
const ejsModuleTags = () => {
	const tags = [...read('views/index.ejs').matchAll(/scripts\/modules\/([\w.-]+\.mjs)/g)].map(([, file]) => file);
	assert.ok(tags.length > 0, 'found no module script tags in views/index.ejs; the parse is broken, not the config');
	return tags;
};

test('every registered display is bundled into the production build', () => {
	const missing = registeredDisplays().filter((file) => !gulpDisplayEntries().includes(file));
	assert.deepEqual(missing, [], `missing from entry.displays.import in gulp/build.mjs, so absent from every DIST=1 build: ${missing.join(', ')}`);
});

test('every registered display is loaded by the development page', () => {
	const missing = registeredDisplays().filter((file) => !ejsModuleTags().includes(file));
	assert.deepEqual(missing, [], `missing a module script tag in views/index.ejs, so absent when running npm start: ${missing.join(', ')}`);
});

test('committed ws.min.css matches a fresh compile of ws.scss', () => {
	// The CLI appends this when it writes the companion map; the JS API does not.
	const committed = read('server/styles/ws.min.css').replace(/\/\*# sourceMappingURL=.*?\*\/\s*$/, '').trim();
	const fresh = sass.compile(path.join(repoRoot, 'server/styles/scss/ws.scss'), { style: 'compressed' }).css.trim();

	assert.equal(committed, fresh, 'server/styles/ws.min.css is stale; run `npm run build:css` and commit the result');
});
