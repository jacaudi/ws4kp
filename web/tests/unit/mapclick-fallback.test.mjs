// Guards the MapClick fallback that current conditions, latest observations and the regional
// observations all rely on when api.weather.gov returns an observation with gaps.
//
// Upstream v8 stopped publishing station data on window (utils/data-loader.mjs exports it
// instead) but mapclick.mjs still looked it up on window.StationInfo. The lookup always failed,
// so the fallback never ran, and the early return reported no missing fields at all. Callers
// then accepted an observation with a null icon and an empty description: current conditions
// showed the "no data" icon and a blank condition instead of trying the next station.
//
// mapclick.mjs imports modules that touch the network at load, so its import specifiers are
// rewritten to stubs; the code under test is the unmodified source on disk.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

// what the stubbed safeJson was asked for; null = "MapClick did not answer"
globalThis.mapclickTestCalls = [];
const STUBS = {
	'./fetch.mjs': 'export const safeJson = async (url) => { globalThis.mapclickTestCalls.push(url); return null; };',
	'./debug.mjs': 'export const debugFlag = () => false;',
	'./data-loader.mjs': `export const StationInfo = Promise.resolve({ KMIA: { id: 'KMIA', lat: 25.7906, lon: -80.3164 } });
		export const RegionalCities = Promise.resolve([]); export const TravelCities = Promise.resolve([]);`,
};

const source = readFileSync(new URL('../../server/scripts/modules/utils/mapclick.mjs', import.meta.url), 'utf8')
	.replace(/(\bfrom\s*)'(\.[^']*)'/g, (match, prefix, specifier) => {
		assert.ok(STUBS[specifier], `no stub for mapclick.mjs import '${specifier}'`);
		return `${prefix}'${toDataUrl(STUBS[specifier])}'`;
	});
const { enhanceObservationWithMapClick } = await import(toDataUrl(source));

const requiredFields = [
	{ name: 'temperature', check: (props) => props.temperature?.value === null, required: true },
	{ name: 'textDescription', check: (props) => props.textDescription === null || props.textDescription === '', required: true },
];

// the shape KMIA actually returned on 2026-10-23: a temperature, but no icon and no description
const blankObservation = () => ({
	timestamp: new Date().toISOString(),
	temperature: { value: 22.8 },
	textDescription: '',
	icon: null,
});

beforeEach(() => {
	globalThis.mapclickTestCalls.length = 0;
});

test('an observation missing a required field asks MapClick for the gap', async () => {
	await enhanceObservationWithMapClick(blankObservation(), { requiredFields, stationId: 'KMIA' });
	assert.equal(globalThis.mapclickTestCalls.length, 1, 'MapClick was never asked, so the fallback is dead');
	assert.match(globalThis.mapclickTestCalls[0], /MapClick\.php.*station=KMIA/);
});

test('a gap MapClick cannot fill is still reported, so the caller tries the next station', async () => {
	const { missingRequired } = await enhanceObservationWithMapClick(blankObservation(), { requiredFields, stationId: 'KMIA' });
	assert.deepEqual(missingRequired, ['textDescription']);
});

test('a station absent from the station list still reports its gaps', async () => {
	const { missingRequired } = await enhanceObservationWithMapClick(blankObservation(), { requiredFields, stationId: 'KXXX' });
	assert.deepEqual(missingRequired, ['textDescription'], 'reporting nothing missing makes the caller accept a blank observation');
	assert.equal(globalThis.mapclickTestCalls.length, 0, 'no coordinates, so nothing to ask MapClick');
});
