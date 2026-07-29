// Regression guard for the regionalcities.json string-coordinate hazard.
//
// datagenerators/output/regionalcities.json ships lat/lon as STRINGS
// ("27.9465"), while datagenerators/output/stations.json uses numbers. Both feed
// the same candidate pool in regionalforecast.mjs.
//
// geoDistance takes a midpoint via (lat1 + lat2). With a string operand that
// concatenates instead of adding, so the distance comes back NaN. Since every
// `NaN >= minSpacing` comparison is false, selectRegionalCities silently rejects
// every candidate after the first — an almost-empty regional map, with no error
// thrown. regionalforecast.mjs therefore coerces both feeds with Number() before
// they reach selection; these tests pin down why that coercion has to stay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectRegionalCities } from '../../server/scripts/modules/regionalforecast-select.mjs';
import { geoDistance } from '../../server/scripts/modules/utils/calc.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const user = { lat: 40, lon: -100 };
// Decimals on BOTH operands, matching the real data. It matters: String(46.0) is
// "46", and "40.2" + "46" parses to a finite 40.246 — wrong, but not NaN. Only
// when both sides carry decimals does the concatenation become unparseable. Every
// coordinate in regionalcities.json has decimals, so NaN is the real-world case,
// and a fixture without them would understate the bug.
const spread = [
	{ id: 'a', lat: 40.25, lon: -100.15 },
	{ id: 'b', lat: 42.35, lon: -100.45 },
	{ id: 'c', lat: 44.55, lon: -100.65 },
	{ id: 'd', lat: 46.75, lon: -100.85 },
];
const asCandidates = (rows, stringify) => rows.map((r) => ({
	...r,
	lat: stringify ? String(r.lat) : r.lat,
	lon: stringify ? String(r.lon) : r.lon,
	baked: false,
	priority: 13,
}));

test('geoDistance returns NaN for string coordinates (the underlying hazard)', () => {
	assert.ok(Number.isNaN(geoDistance('-100.15', '40.25', '-100.45', '42.35')));
	assert.ok(Number.isFinite(geoDistance(-100.15, 40.25, -100.45, 42.35)));
});

test('geoDistance can also return a wrong-but-finite value for string coordinates', () => {
	// The quieter half of the same bug: when a concatenation happens to remain
	// parseable, no NaN ever appears and the distance is simply wrong. Guarding
	// only against NaN would miss this.
	//
	// The corrupted midpoint only reaches the result through the longitude term
	// (dx = (lon2 - lon1) * cos(midLat)), so the longitudes must differ — with equal
	// longitudes dx is 0 and the wrong cosine cancels out.
	const bad = geoDistance('-100', '40.2', '-98', '46');
	assert.ok(Number.isFinite(bad));
	assert.notEqual(bad, geoDistance(-100, 40.2, -98, 46));
});

test('string coordinates collapse selection to a single city', () => {
	const out = selectRegionalCities(user, asCandidates(spread, true), { count: 10, minSpacing: 1.0 });
	assert.equal(out.length, 1, 'string coords should expose the collapse this guard exists for');
});

test('numeric coordinates select the full spread', () => {
	const out = selectRegionalCities(user, asCandidates(spread, false), { count: 10, minSpacing: 1.0 });
	assert.equal(out.length, 4);
});

test('Number() coercion restores correct selection for string coordinates', () => {
	const coerced = asCandidates(spread, true)
		.map((c) => ({ ...c, lat: Number(c.lat), lon: Number(c.lon) }));
	const out = selectRegionalCities(user, coerced, { count: 10, minSpacing: 1.0 });
	assert.equal(out.length, 4);
});

test('regionalforecast.mjs coerces both city and station feeds', () => {
	// Pin the coercion at the call site rather than trusting the data files to
	// keep their current types — regionalcities.json already flipped once.
	const src = readFileSync(
		new URL('../../server/scripts/modules/regionalforecast.mjs', import.meta.url),
		'utf8',
	);
	const cities = src.match(/const cities = RegionalCities\.map\([\s\S]*?\)\);/);
	const stations = src.match(/const stations = Object\.values\(StationInfo\)\.map\([\s\S]*?\)\);/);
	assert.ok(cities, 'could not locate the RegionalCities candidate mapping; this guard needs updating');
	assert.ok(stations, 'could not locate the StationInfo candidate mapping; this guard needs updating');
	for (const [name, block] of [['cities', cities[0]], ['stations', stations[0]]]) {
		assert.match(block, /lat:\s*Number\(/, `${name} feed must coerce lat with Number()`);
		assert.match(block, /lon:\s*Number\(/, `${name} feed must coerce lon with Number()`);
	}
});

test('the shipped data files still have the types this guard assumes', () => {
	const cities = read('../../datagenerators/output/regionalcities.json');
	const stations = Object.values(read('../../datagenerators/output/stations.json'));
	assert.ok(cities.length > 0 && stations.length > 0);
	// Not asserting a specific type — only that whatever ships stays numeric-parseable,
	// which is the real contract the coercion depends on.
	for (const c of cities) {
		assert.ok(Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)), `regionalcities entry has unparseable coords: ${JSON.stringify(c)}`);
	}
	for (const s of stations) {
		assert.ok(Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)), `stations entry has unparseable coords: ${JSON.stringify(s)}`);
	}
});
