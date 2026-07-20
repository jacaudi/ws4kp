import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	selectRegionalCities,
	regionalSelectionConfig,
	inVisibleWindow,
} from '../../server/scripts/modules/regionalforecast-select.mjs';

const user = { lat: 40, lon: -100 };

test('selectRegionalCities ranks nearest-to-user first', () => {
	const cands = [
		{ id: 'far', lat: 44, lon: -100, baked: false, priority: 1 },
		{ id: 'near', lat: 40.2, lon: -100, baked: false, priority: 13 },
	];
	const out = selectRegionalCities(user, cands, { count: 10, minSpacing: 0.1 });
	assert.equal(out[0].id, 'near');
});

test('selectRegionalCities dedups within minSpacing', () => {
	const cands = [
		{ id: 'a', lat: 40.1, lon: -100, baked: false, priority: 13 },
		{ id: 'b', lat: 40.15, lon: -100, baked: false, priority: 13 }, // ~0.05 from a
		{ id: 'c', lat: 41.5, lon: -100, baked: false, priority: 13 },
	];
	const ids = selectRegionalCities(user, cands, { count: 10, minSpacing: 1.0 }).map((c) => c.id);
	assert.ok(ids.includes('a'));
	assert.ok(!ids.includes('b')); // within 1.0 of a
	assert.ok(ids.includes('c'));
});

test('selectRegionalCities caps at count', () => {
	const cands = Array.from({ length: 30 }, (_, i) => ({
		id: `s${i}`, lat: 40 + (i * 0.5), lon: -100, baked: false, priority: 13,
	}));
	const out = selectRegionalCities(user, cands, { count: 5, minSpacing: 0.1 });
	assert.equal(out.length, 5);
});

test('selectRegionalCities uses priority as a proximity-subordinate tiebreaker', () => {
	// Effectively equidistant; lower priority number (bigger airport) wins the near-tie.
	const cands = [
		{ id: 'small', lat: 40.5, lon: -100, baked: false, priority: 13 },
		{ id: 'big', lat: 40.5, lon: -100.001, baked: false, priority: 1 },
	];
	const out = selectRegionalCities(user, cands, { count: 1, minSpacing: 0.01 });
	assert.equal(out[0].id, 'big');
});

test('selectRegionalCities prefers baked cities in a near-tie', () => {
	const cands = [
		{ id: 'station', lat: 40.5, lon: -100, baked: false, priority: 1 },
		{ id: 'city', lat: 40.5, lon: -100.001, baked: true, priority: 0 },
	];
	const out = selectRegionalCities(user, cands, { count: 1, minSpacing: 0.01 });
	assert.equal(out[0].id, 'city');
});

test('inVisibleWindow honors the right-edge maxLon-1 fudge', () => {
	const mm = {
		minLat: 38, maxLat: 42, minLon: -105, maxLon: -95,
	};
	assert.equal(inVisibleWindow({ lat: 40, lon: -100 }, mm), true);
	assert.equal(inVisibleWindow({ lat: 40, lon: -95.5 }, mm), false); // inside maxLon-1 band
	assert.equal(inVisibleWindow({ lat: 50, lon: -100 }, mm), false);
});

test('regionalSelectionConfig scales count up and minSpacing down for larger windows', () => {
	assert.deepEqual(regionalSelectionConfig(false, false), { count: 16, minSpacing: 1.0 });
	assert.deepEqual(regionalSelectionConfig(true, false), { count: 22, minSpacing: 0.85 });
	assert.deepEqual(regionalSelectionConfig(false, true), { count: 28, minSpacing: 0.75 });
});
