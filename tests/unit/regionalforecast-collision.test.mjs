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

// --- regression: degenerate measurements must not silently disable decluttering ---
// declutterLabels unions child boxes and skips zero-width children, so a label
// measured before layout yields {left: Infinity, right: -Infinity, ...}. Every
// rectsOverlap test against that is false, so collision detection quietly became a
// no-op and overlapping labels shipped. Those items are now discarded up front.

test('resolveLabelCollisions discards unmeasured (degenerate) rects', () => {
	const degenerate = {
		left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity,
	};
	const items = [
		{ el: 'a', dist: 0, rect: { left: 0, top: 0, right: 50, bottom: 50 } },
		{ el: 'b', dist: 1, rect: degenerate },
	];
	assert.deepEqual(resolveLabelCollisions(items, 2).map((i) => i.el), ['a']);
});

test('resolveLabelCollisions drops labels overlapping an obstacle', () => {
	const items = [
		{ el: 'onLogo', dist: 0, rect: { left: 60, top: 35, right: 130, bottom: 90 } },
		{ el: 'clear', dist: 1, rect: { left: 300, top: 200, right: 380, bottom: 250 } },
	];
	const logo = { left: 50, top: 30, right: 135, bottom: 101 };
	assert.deepEqual(resolveLabelCollisions(items, 2, [logo]).map((i) => i.el), ['clear']);
});

test('resolveLabelCollisions drops labels that escape the drawable bounds', () => {
	const bounds = { left: 0, top: 0, right: 640, bottom: 310 };
	const items = [
		{ el: 'inside', dist: 0, rect: { left: 10, top: 10, right: 90, bottom: 70 } },
		{ el: 'offBottom', dist: 1, rect: { left: 10, top: 280, right: 90, bottom: 340 } },
		{ el: 'offRight', dist: 2, rect: { left: 600, top: 10, right: 700, bottom: 70 } },
	];
	assert.deepEqual(resolveLabelCollisions(items, 2, [], bounds).map((i) => i.el), ['inside']);
});

test('resolveLabelCollisions still removes real label-on-label overlap (Tampa/Sebring)', () => {
	// measured from the live page; these overlapped by 21x26px and both shipped
	const items = [
		{ el: 'Tampa', dist: 0.0, rect: { left: 280, top: 258, right: 364, bottom: 320 } },
		{ el: 'Leesburg', dist: 1.05, rect: { left: 316, top: 193, right: 400, bottom: 256 } },
		{ el: 'Sebring', dist: 1.10, rect: { left: 342, top: 294, right: 417, bottom: 356 } },
		{ el: 'FtMyers', dist: 1.55, rect: { left: 319, top: 362, right: 401, bottom: 425 } },
	];
	const kept = resolveLabelCollisions(items, 2).map((i) => i.el);
	assert.ok(kept.includes('Tampa'));
	assert.ok(!kept.includes('Sebring'), 'Sebring overlaps Tampa and must be dropped');
});
