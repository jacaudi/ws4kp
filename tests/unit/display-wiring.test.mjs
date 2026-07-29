// Guard for the "module missing from the production bundle" bug class.
//
// The browser loads display modules by two entirely separate paths, and the list
// of modules is hand-maintained in both:
//
//   dev  (npm start)          views/index.ejs  — one <script type="module"> per file
//   prod (DIST=1, Docker)     gulp/build.mjs   — webpackOptions.entry.*.import
//
// views/index.ejs picks the path at render time with `if (production)`, so a module
// missing from the webpack entry is INVISIBLE locally and absent from every shipped
// image. That is exactly what happened to the Air Quality display: it shipped in
// PR #7 and was missing from every production build until PR #31 two days later,
// because airquality.mjs was never added to entry.displays.import. Nothing failed —
// `/` still returned 200 — the display simply did not exist in the bundle.
//
// Every display registers itself by calling registerDisplay() at module scope, so a
// module absent from the entry list is never bundled, never executes, never
// registers, and its checkbox never appears. That makes registerDisplay() the
// authoritative source of truth these tests check both lists against.
//
// NOTE gulp/build.mjs has a SECOND, non-authoritative list: `mjsSources`, the gulp
// src() glob. webpack-stream ignores the piped files when options.entry is set, so
// only the entry config functionally matters. These tests deliberately scope their
// parsing to the webpackOptions block so mjsSources cannot mask a real gap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const repoFile = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// Everything after `scripts/modules/`, so the two lists' different prefixes
// ('scripts/modules/x.mjs' vs './server/scripts/modules/x.mjs') compare directly.
const MODULE_REF = /scripts\/modules\/([A-Za-z0-9/_-]+\.mjs)/g;
const modulesIn = (text) => new Set(Array.from(text.matchAll(MODULE_REF), (m) => m[1]));

// utils/* are pulled in transitively by the modules that import them, so index.ejs
// never lists them while entry.shared does. Comparing only top-level modules keeps
// the two lists comparable.
const topLevelOnly = (set) => new Set([...set].filter((m) => !m.includes('/')));

const gulpSource = repoFile('gulp/build.mjs');

// Bound the parse to the webpack config. `mjsSources` is defined after it and lists
// an overlapping but NOT authoritative set; including it would let a module missing
// from `entry` still look present.
const webpackBlock = (() => {
	const start = gulpSource.indexOf('const webpackOptions = {');
	const end = gulpSource.indexOf('const mjsSources');
	assert.ok(start !== -1, 'could not locate `const webpackOptions = {` in gulp/build.mjs; this guard needs updating');
	assert.ok(end > start, 'could not locate `const mjsSources` after webpackOptions in gulp/build.mjs; this guard needs updating');
	return gulpSource.slice(start, end);
})();

const displaysEntry = (() => {
	const start = webpackBlock.indexOf('displays: {');
	assert.ok(start !== -1, 'could not locate `displays: {` in webpackOptions.entry; this guard needs updating');
	const end = webpackBlock.indexOf('],', start);
	assert.ok(end > start, 'could not locate the end of entry.displays.import; this guard needs updating');
	return webpackBlock.slice(start, end);
})();

const ejsSource = repoFile('views/index.ejs');

const registeringModules = readdirSync(new URL('../../server/scripts/modules/', import.meta.url))
	.filter((f) => f.endsWith('.mjs'))
	.filter((f) => /registerDisplay\(/.test(repoFile(`server/scripts/modules/${f}`)));

test('every display that registers itself is in the production bundle', () => {
	// The PR #31 bug, stated directly. A display absent here is missing from every
	// Docker image while working perfectly under `npm start`.
	const bundled = modulesIn(displaysEntry);
	assert.ok(registeringModules.length > 0, 'found no modules calling registerDisplay(); this guard needs updating');
	const missing = registeringModules.filter((m) => !bundled.has(m));
	assert.deepEqual(
		missing,
		[],
		`display module(s) call registerDisplay() but are absent from webpackOptions.entry.displays.import in gulp/build.mjs, so they will be missing from every production image: ${missing.join(', ')}`,
	);
});

test('every display that registers itself is loaded in dev', () => {
	const devLoaded = modulesIn(ejsSource);
	const missing = registeringModules.filter((m) => !devLoaded.has(m));
	assert.deepEqual(
		missing,
		[],
		`display module(s) call registerDisplay() but have no <script type="module"> in views/index.ejs, so they will not load under npm start: ${missing.join(', ')}`,
	);
});

test('the dev and production module lists agree', () => {
	// Catches the same class for non-display modules (features, shared) that the
	// registerDisplay() checks above cannot see.
	const dev = topLevelOnly(modulesIn(ejsSource));
	const prod = topLevelOnly(modulesIn(webpackBlock));
	const devOnly = [...dev].filter((m) => !prod.has(m)).sort();
	const prodOnly = [...prod].filter((m) => !dev.has(m)).sort();
	assert.deepEqual(devOnly, [], `module(s) loaded in views/index.ejs but absent from the webpack entry, so they ship only in dev: ${devOnly.join(', ')}`);
	assert.deepEqual(prodOnly, [], `module(s) in the webpack entry but absent from views/index.ejs, so they ship only in production: ${prodOnly.join(', ')}`);
});
