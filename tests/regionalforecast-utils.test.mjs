// Stub browser globals required by the module import chain before any imports
// regionalforecast-utils → units → settings → share.mjs which references document
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Set up minimal browser stubs before dynamic import resolves the module graph
globalThis.document = {
	addEventListener: () => {},
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
};
globalThis.window = { location: { href: '' } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { getXYForCity } = await import('../server/scripts/modules/regionalforecast-utils.mjs');

// Helper: compute expected AK result using getXYForCityAK formula (x * 37)
const expectedAK = (City, MaxLatitude, MinLongitude) => {
	let x = (City.lon - MinLongitude) * 37;
	let y = (MaxLatitude - City.lat) * 70;
	if (y < 30) y = 30;
	if (y > 282) y = 282;
	if (x < 40) x = 40;
	if (x > 580) x = 580;
	return { x, y };
};

// Helper: compute expected HI result using getXYForCityHI formula (x * 57, same as CONUS)
const expectedHI = (City, MaxLatitude, MinLongitude) => {
	let x = (City.lon - MinLongitude) * 57;
	let y = (MaxLatitude - City.lat) * 70;
	if (y < 30) y = 30;
	if (y > 282) y = 282;
	if (x < 40) x = 40;
	if (x > 580) x = 580;
	return { x, y };
};

// Helper: compute expected CONUS result (x * 57)
const expectedCONUS = (City, MaxLatitude, MinLongitude, maxX = 580, maxY = 282) => {
	let x = (City.lon - MinLongitude) * 57;
	let y = (MaxLatitude - City.lat) * 70;
	if (y < 30) y = 30;
	if (y > maxY) y = maxY;
	if (x < 40) x = 40;
	if (x > maxX) x = maxX;
	return { x, y };
};

// AK fixture — coordinates chosen so x does NOT clamp to 580, exposing the *37 vs *57 difference.
// lon - minLon ≈ 2.6 → x_ak ≈ 96, x_conus ≈ 148 (both below 580, so clamp doesn't hide the bug)
const akCity = { lat: 64.5, lon: -165.4 };
const akMaxLat = 71.5;
const akMinLon = -168.0;

// HI fixture — HI variant uses same *57 multiplier as CONUS, so the test verifies
// control flow (function returns rather than falling through) rather than numeric difference.
const hiCity = { lat: 21.3, lon: -157.8 };
const hiMaxLat = 22.5;
const hiMinLon = -160.0;

// CONUS fixture
const conusCity = { lat: 39.7, lon: -104.9 };
const conusMaxLat = 50.0;
const conusMinLon = -125.0;

test('getXYForCity returns AK variant result when state === "AK"', () => {
	const result = getXYForCity(akCity, akMaxLat, akMinLon, 'AK');
	const expected = expectedAK(akCity, akMaxLat, akMinLon);
	assert.deepStrictEqual(result, expected, `Expected AK result ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
});

test('AK result uses * 37 multiplier (not CONUS * 57) — bug guard', () => {
	// AK uses x * 37; CONUS uses x * 57.
	// With the AK fixture (lon - minLon ≈ 2.6), x_ak ≈ 96 and x_conus ≈ 148 (neither clamped).
	// If getXYForCity falls through to CONUS math (the bug), it returns the *57 value instead.
	const akResult = getXYForCity(akCity, akMaxLat, akMinLon, 'AK');
	const conusResult = expectedCONUS(akCity, akMaxLat, akMinLon);
	assert.notDeepStrictEqual(akResult, conusResult, `AK result should differ from CONUS result — AK uses *37, CONUS uses *57. Got: AK=${JSON.stringify(akResult)}, CONUS=${JSON.stringify(conusResult)}`);
});

test('getXYForCity returns HI variant result when state === "HI"', () => {
	// HI variant uses the same *57 multiplier as CONUS, so we verify control flow:
	// the function must return a value (not undefined) and it must equal the HI formula output.
	const result = getXYForCity(hiCity, hiMaxLat, hiMinLon, 'HI');
	const expected = expectedHI(hiCity, hiMaxLat, hiMinLon);
	assert.deepStrictEqual(result, expected, `Expected HI result ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
});

test('getXYForCity returns CONUS result when state is undefined', () => {
	const result = getXYForCity(conusCity, conusMaxLat, conusMinLon, undefined);
	const expected = expectedCONUS(conusCity, conusMaxLat, conusMinLon);
	assert.deepStrictEqual(result, expected, `Expected CONUS result ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
});
