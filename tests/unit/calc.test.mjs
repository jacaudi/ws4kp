import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoDistance } from '../../server/scripts/modules/utils/calc.mjs';

test('geoDistance is zero for identical points', () => {
	assert.equal(geoDistance(-122, 47, -122, 47), 0);
});

test('geoDistance weights longitude by cos(latitude) at 45N', () => {
	const ew = geoDistance(0, 45, 1, 45); // 1 deg east-west at 45N
	const ns = geoDistance(0, 45, 0, 46); // 1 deg north-south
	assert.ok(ew < ns, 'E-W degree must be shorter than N-S at 45N');
	assert.ok(Math.abs(ew - Math.cos((45 * Math.PI) / 180)) < 1e-9);
	assert.equal(ns, 1);
});

test('geoDistance is symmetric', () => {
	assert.equal(
		geoDistance(-100, 40, -98, 41),
		geoDistance(-98, 41, -100, 40),
	);
});
