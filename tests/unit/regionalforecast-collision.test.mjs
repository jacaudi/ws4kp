import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabelCollisions } from '../../server/scripts/modules/regionalforecast-select.mjs';

test('keeps nearest-to-user and drops overlapping farther labels', () => {
	const items = [
		{ id: 'near', dist: 1, rect: { left: 0, top: 0, right: 100, bottom: 20 } },
		{ id: 'overlap', dist: 5, rect: { left: 50, top: 5, right: 150, bottom: 25 } },
		{ id: 'clear', dist: 9, rect: { left: 200, top: 0, right: 260, bottom: 20 } },
	];
	const ids = resolveLabelCollisions(items, 2).map((i) => i.id).sort();
	assert.deepEqual(ids, ['clear', 'near']);
});

test('nearest is kept even when supplied out of order', () => {
	const items = [
		{ id: 'overlap', dist: 5, rect: { left: 50, top: 5, right: 150, bottom: 25 } },
		{ id: 'near', dist: 1, rect: { left: 0, top: 0, right: 100, bottom: 20 } },
	];
	const ids = resolveLabelCollisions(items, 2).map((i) => i.id);
	assert.deepEqual(ids, ['near']);
});

test('tolerates a bare kiss within pad', () => {
	const items = [
		{ id: 'a', dist: 1, rect: { left: 0, top: 0, right: 100, bottom: 20 } },
		{ id: 'b', dist: 2, rect: { left: 101, top: 0, right: 200, bottom: 20 } }, // 1px gap
	];
	assert.equal(resolveLabelCollisions(items, 2).length, 2);
});
