import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getXYForCity } from '../../server/scripts/modules/regionalforecast-select.mjs';

test('getXYForCity: state actually affects x (AK does not fall through to CONUS)', () => {
	const city = { lon: -150, lat: 62 };
	const conus = getXYForCity(city, 65, -155, undefined, 580, 282);
	const ak = getXYForCity(city, 65, -155, 'AK', 580, 282);
	// Before the fix, AK fell through to the CONUS formula and produced the same x.
	assert.notEqual(ak.x, conus.x);
});

test('getXYForCity: clamps x into [40, maxX] and y into [30, maxY]', () => {
	const r = getXYForCity({ lon: -60, lat: 20 }, 65, -155, undefined, 580, 282);
	assert.ok(r.x >= 40 && r.x <= 580);
	assert.ok(r.y >= 30 && r.y <= 282);
});
