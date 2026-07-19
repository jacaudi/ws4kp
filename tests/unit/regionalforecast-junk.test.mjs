import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterJunkStations } from '../../server/scripts/modules/regionalforecast-select.mjs';

test('filterJunkStations drops stations with priority >= 50', () => {
	const out = filterJunkStations([
		{ id: 'A', baked: false, priority: 12 },
		{ id: 'B', baked: false, priority: 50 }, // weather station
		{ id: 'C', baked: false, priority: 99 }, // unknown/non-town
	]);
	assert.deepEqual(out.map((c) => c.id), ['A']);
});

test('filterJunkStations keeps baked cities regardless of priority', () => {
	const out = filterJunkStations([
		{ city: 'Everett', baked: true },
		{ city: 'Canal', baked: true, priority: 99 },
	]);
	assert.equal(out.length, 2);
});

test('filterJunkStations treats missing priority as junk (>= 50)', () => {
	const out = filterJunkStations([{ id: 'X', baked: false }]);
	assert.equal(out.length, 0);
});
