// Loads one of the three scrolling display modules with its imports redirected to
// scroll-display-stubs.mjs, and returns the display instance it registers.
//
// Why this instead of importing the module directly: hazards.mjs / hourly.mjs / travelforecast.mjs
// construct themselves at module scope and reach straight into the browser (document, navigation,
// the network). Why this instead of exporting contentSignature() from those files: they are
// byte-identical to upstream/main and this fork keeps them that way. Rewriting only their import
// specifiers leaves every line of logic - drawLongCanvas, baseCountChange and the module-private
// contentSignature - exactly as shipped.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { takeRegistered } from './scroll-display-stubs.mjs';

const STUBS = new URL('./scroll-display-stubs.mjs', import.meta.url).href;

// Modules that are pure enough to load for real: no DOM, no network. Using the genuine article
// keeps the test honest - real STATUS symbols, the real scroll-timing maths, the real luxon build
// the browser ships.
const REAL = new Set(['./status.mjs', './utils/scroll-timing.mjs', '../vendor/auto/luxon.mjs']);

// specifier -> what the stub module supplies for it. A display that grows a new import trips the
// assertion below rather than failing somewhere confusing.
const STUB_EXPORTS = {
	'./weatherdisplay.mjs': { default: 'WeatherDisplay' },
	'./navigation.mjs': { named: ['registerDisplay', 'timeZone'] },
	'./settings.mjs': { default: 'settings' },
	'./almanac.mjs': { default: 'getSun' },
	'./icons.mjs': { named: ['getSmallIcon', 'getHourlyIcon'] },
	'./utils/fetch.mjs': { named: ['safeJson', 'safePromiseAll'] },
	'./utils/debug.mjs': { named: ['debugFlag'] },
	'./utils/calc.mjs': { named: ['directionToNSEW'] },
	'./utils/units.mjs': { named: ['temperature', 'windSpeed'] },
};

const MODULES = new URL('../../../server/scripts/modules/', import.meta.url);

const stubUrlFor = (specifier) => {
	if (REAL.has(specifier)) return new URL(specifier, MODULES).href;
	const stub = STUB_EXPORTS[specifier];
	assert.ok(stub, `no test stub for import '${specifier}'; add one to scroll-display-stubs.mjs or to REAL`);
	const clauses = [...(stub.default ? [`${stub.default} as default`] : []), ...(stub.named ?? [])];
	const source = `export { ${clauses.join(', ')} } from ${JSON.stringify(STUBS)};\n`;
	return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
};

const SPECIFIER = /(\bfrom\s*)'(\.[^']*)'/g;

let nonce = 0;

// load a display module fresh and hand back the instance it registered
const loadDisplay = async (moduleName) => {
	const path = new URL(`../../../server/scripts/modules/${moduleName}`, import.meta.url);
	const source = readFileSync(path, 'utf8')
		.replace(SPECIFIER, (match, prefix, specifier) => `${prefix}'${stubUrlFor(specifier)}'`);

	// the nonce defeats the module cache so every test gets its own instance
	nonce += 1;
	const url = `data:text/javascript;base64,${Buffer.from(`${source}\n// instance ${nonce}\n`).toString('base64')}`;
	await import(url);

	const display = takeRegistered();
	assert.ok(display, `${moduleName} did not call registerDisplay()`);
	return display;
};

export default loadDisplay;
