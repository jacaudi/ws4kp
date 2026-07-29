import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LABEL_BOX,
	STATION_RANK_PENALTY,
	selectRegionalCities,
	regionalSelectionConfig,
	inVisibleWindow,
} from '../../server/scripts/modules/regionalforecast-select.mjs';

const user = { lat: 40, lon: -100 };

// Selection spaces labels in PIXELS, so every candidate carries the projected xy
// that regionalforecast.mjs attaches before calling. Defaults put each candidate
// far enough apart that spacing never interferes with a ranking assertion.
let seq = 0;
const cand = (props) => {
	seq += 1;
	return {
		id: `c${seq}`,
		lat: 40,
		lon: -100,
		baked: false,
		priority: 13,
		xy: { x: seq * LABEL_BOX.w * 3, y: seq * LABEL_BOX.h * 3 },
		...props,
	};
};

test('selectRegionalCities ranks nearest-to-user first', () => {
	const cands = [
		cand({ id: 'far', lat: 44, lon: -100 }),
		cand({ id: 'near', lat: 40.2, lon: -100 }),
	];
	const out = selectRegionalCities(user, cands, { count: 10 });
	assert.equal(out[0].id, 'near');
});

test('selectRegionalCities drops a candidate whose label box overlaps a kept one', () => {
	// 'b' sits a few pixels from 'a', so their rendered labels would collide.
	const cands = [
		cand({ id: 'a', lat: 40.1, lon: -100, xy: { x: 300, y: 150 } }),
		cand({ id: 'b', lat: 40.15, lon: -100, xy: { x: 310, y: 155 } }),
		cand({ id: 'c', lat: 40.2, lon: -100, xy: { x: 300 + LABEL_BOX.w * 2, y: 150 } }),
	];
	const ids = selectRegionalCities(user, cands, { count: 10 }).map((c) => c.id);
	assert.deepEqual(ids, ['a', 'c']);
});

test('selectRegionalCities keeps labels that clear each other vertically', () => {
	// The old isotropic degree rule rejected this pair; a stacked pair only needs
	// to clear the label HEIGHT, which is far less than its width.
	const cands = [
		cand({ id: 'top', lat: 40.1, lon: -100, xy: { x: 300, y: 100 } }),
		cand({ id: 'bottom', lat: 40.2, lon: -100, xy: { x: 300, y: 100 + LABEL_BOX.h + 2 } }),
	];
	const ids = selectRegionalCities(user, cands, { count: 10 }).map((c) => c.id);
	assert.deepEqual(ids, ['top', 'bottom']);
});

test('selectRegionalCities allows labels to abut exactly', () => {
	// Deliberate: boxes one label-height apart do not overlap, so both are kept. Demanding
	// a real gap instead was measured to cost a label in the sparse coastal windows that
	// need one most, because their candidates stack vertically and the height is what
	// binds. Keep this permissive — the declutter pass is the backstop for real overlaps.
	const abutting = [
		cand({ id: 'first', lat: 40.1, lon: -100, xy: { x: 300, y: 100 } }),
		cand({ id: 'stacked', lat: 40.2, lon: -100, xy: { x: 300, y: 100 + LABEL_BOX.h } }),
	];
	assert.deepEqual(
		selectRegionalCities(user, abutting, { count: 10 }).map((c) => c.id),
		['first', 'stacked'],
	);
});

test('selectRegionalCities still rejects a one-pixel overlap', () => {
	// The other side of the line above: abutting is fine, overlapping is not.
	const overlapping = [
		cand({ id: 'first', lat: 40.1, lon: -100, xy: { x: 300, y: 100 } }),
		cand({ id: 'overlapping', lat: 40.2, lon: -100, xy: { x: 300, y: 100 + LABEL_BOX.h - 1 } }),
	];
	assert.deepEqual(
		selectRegionalCities(user, overlapping, { count: 10 }).map((c) => c.id),
		['first'],
	);
});

test('selectRegionalCities caps at count', () => {
	const cands = Array.from({ length: 30 }, (_, i) => cand({
		id: `s${i}`, lat: 40 + (i * 0.5), lon: -100,
	}));
	const out = selectRegionalCities(user, cands, { count: 5 });
	assert.equal(out.length, 5);
});

test('selectRegionalCities uses priority as a proximity-subordinate tiebreaker', () => {
	// Effectively equidistant; lower priority number (bigger airport) wins the near-tie.
	const cands = [
		cand({ id: 'small', lat: 40.5, lon: -100, priority: 13 }),
		cand({ id: 'big', lat: 40.5, lon: -100.001, priority: 1 }),
	];
	const out = selectRegionalCities(user, cands, { count: 1 });
	assert.equal(out[0].id, 'big');
});

test('a station yields to a named city it would otherwise outrank on distance', () => {
	// The station is genuinely nearer, but by less than the penalty, so the city wins.
	const cands = [
		cand({ id: 'station', lat: 40.2, lon: -100, baked: false }),
		cand({ id: 'city', lat: 40.7, lon: -100, baked: true, priority: 0 }),
	];
	const out = selectRegionalCities(user, cands, { count: 1 });
	assert.equal(out[0].id, 'city');
});

test('a station still wins when it is nearer by more than the penalty', () => {
	// De-emphasis must not become "cities always win" — a close station beats a
	// remote city, otherwise sparse regions would reach across the map for a name.
	const cands = [
		cand({ id: 'station', lat: 40.05, lon: -100, baked: false }),
		cand({ id: 'city', lat: 41.5, lon: -100, baked: true, priority: 0 }),
	];
	const out = selectRegionalCities(user, cands, { count: 1 });
	assert.equal(out[0].id, 'station');
	assert.ok(STATION_RANK_PENALTY > 0 && STATION_RANK_PENALTY < 1.45);
});

test('selectRegionalCities skips candidates with a missing or non-finite xy', () => {
	// Mirrors the decluttering bug this module already guards against: an unusable
	// box must mean "cannot be placed", never "overlaps nothing".
	const cands = [
		cand({ id: 'noXy', lat: 40.1, lon: -100, xy: undefined }),
		cand({ id: 'nanXy', lat: 40.2, lon: -100, xy: { x: NaN, y: 10 } }),
		cand({ id: 'ok', lat: 40.3, lon: -100, xy: { x: 300, y: 150 } }),
	];
	const ids = selectRegionalCities(user, cands, { count: 10 }).map((c) => c.id);
	assert.deepEqual(ids, ['ok']);
});

test('inVisibleWindow honors the right-edge maxLon-1 fudge', () => {
	const mm = {
		minLat: 38, maxLat: 42, minLon: -105, maxLon: -95,
	};
	assert.equal(inVisibleWindow({ lat: 40, lon: -100 }, mm), true);
	assert.equal(inVisibleWindow({ lat: 40, lon: -95.5 }, mm), false); // inside maxLon-1 band
	assert.equal(inVisibleWindow({ lat: 50, lon: -100 }, mm), false);
});

test('regionalSelectionConfig scales the count cap up for larger windows', () => {
	// Spacing is no longer part of this config: it is measured in pixels against a
	// label box that is identical in every display mode.
	assert.deepEqual(regionalSelectionConfig(false, false), { count: 16 });
	assert.deepEqual(regionalSelectionConfig(true, false), { count: 22 });
	assert.deepEqual(regionalSelectionConfig(false, true), { count: 28 });
});
