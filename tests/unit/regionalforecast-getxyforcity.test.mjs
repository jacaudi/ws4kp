import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getXYForCity, projectionPxPerDeg } from '../../server/scripts/modules/regionalforecast-select.mjs';

const SCALE = 640 / 480; // standard-window scale = available.x / (mapOffsetXY.x * 2)

test('projectionPxPerDeg: CONUS uses basemap 41.775 / 55.2', () => {
	assert.deepEqual(projectionPxPerDeg('CONUS'), { lon: 41.775, lat: 55.2 });
	assert.deepEqual(projectionPxPerDeg(undefined), { lon: 41.775, lat: 55.2 });
	assert.deepEqual(projectionPxPerDeg('HI'), { lon: 41.775, lat: 55.2 });
});

test('projectionPxPerDeg: AK uses basemap 25 / 56', () => {
	assert.deepEqual(projectionPxPerDeg('AK'), { lon: 25, lat: 56 });
});

test('getXYForCity: CONUS marker px/deg = basemap x scale (not the old 57/70)', () => {
	const r = getXYForCity({ lon: -100, lat: 40 }, 45, -110, 'CONUS', SCALE, 5000, 5000);
	assert.ok(Math.abs(r.x - (10 * 41.775 * SCALE)) < 1e-6);
	assert.ok(Math.abs(r.y - (5 * 55.2 * SCALE)) < 1e-6);
});

test('getXYForCity: AK marker px/deg = 25/56 x scale (state affects x, no fallthrough)', () => {
	const r = getXYForCity({ lon: -150, lat: 62 }, 65, -155, 'AK', SCALE, 5000, 5000);
	assert.ok(Math.abs(r.x - (5 * 25 * SCALE)) < 1e-6);
	assert.ok(Math.abs(r.y - (3 * 56 * SCALE)) < 1e-6);
});

// getXYForCity used to clamp out-of-range coordinates to the map border. That
// pinned off-map cities to the edge and drew them at coordinates that were simply
// wrong. It now returns undefined and the caller drops the candidate, matching
// upstream's behaviour (netbymatt/ws4kp@2e87d17).

test('getXYForCity: widescreen maxX rejects AK rather than clamping', () => {
	assert.equal(getXYForCity({ lon: -60, lat: 62 }, 65, -175, 'AK', SCALE, 794, 282), undefined);
});

test('getXYForCity: rejects a city past maxY', () => {
	assert.equal(getXYForCity({ lon: -100, lat: 20 }, 65, -110, 'CONUS', SCALE, 580, 282), undefined);
});

test('getXYForCity: rejects each edge independently', () => {
	// above the top edge (y < 30)
	assert.equal(getXYForCity({ lon: -100, lat: 64.9 }, 65, -110, 'CONUS', SCALE, 5000, 5000), undefined);
	// left of the left edge (x < 40)
	assert.equal(getXYForCity({ lon: -109.9 }, 65, -110, 'CONUS', SCALE, 5000, 5000), undefined);
	// past the right edge (x > maxX)
	assert.equal(getXYForCity({ lon: -100, lat: 60 }, 65, -110, 'CONUS', SCALE, 100, 5000), undefined);
});

test('getXYForCity: still returns coordinates for an in-range city', () => {
	const r = getXYForCity({ lon: -100, lat: 60 }, 65, -110, 'CONUS', SCALE, 5000, 5000);
	assert.ok(r && Number.isFinite(r.x) && Number.isFinite(r.y));
	assert.ok(r.y >= 30 && r.x >= 40);
});
