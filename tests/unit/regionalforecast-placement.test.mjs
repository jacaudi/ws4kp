import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	LABEL_BOX,
	STATE_MAPS,
	labelWidth,
	linearProjection,
	placeCandidates,
} from '../../server/scripts/modules/regionalforecast-select.mjs';

// a label that fits nowhere but the middle of a 640x282 standard-mode map
const AREA = { width: 640, height: 282 };
const identity = { forward: ([lon, lat]) => [lon, lat] };
const cand = (id, x, y, width = 72) => ({ id, lon: x, lat: y, labelWidth: width });

test('labelWidth: short names take the temp and icon row width', () => {
	assert.equal(labelWidth('Hays'), LABEL_BOX.minWidth);
	assert.equal(labelWidth(''), LABEL_BOX.minWidth);
});

test('labelWidth: long names are as wide as the text (measured 114px at 12 chars)', () => {
	assert.equal(labelWidth('Colorado Spr'), 114);
	assert.equal(labelWidth('Fort Wayne'), 95);
});

test('placeCandidates attaches the map and screen positions', () => {
	const [placed] = placeCandidates([cand('a', 300, 150)], identity, [100, 50], AREA);
	assert.deepEqual(placed.pxy, [300, 150]);
	assert.deepEqual(placed.xy, { x: 200, y: 100 });
});

test('placeCandidates keeps a label that fits entirely inside the area', () => {
	assert.equal(placeCandidates([cand('a', 320, 141)], identity, [0, 0], AREA).length, 1);
});

test('placeCandidates drops a label crossing any edge, each edge independently', () => {
	const { offsetX, offsetY, h } = LABEL_BOX;
	const edges = {
		left: cand('left', -offsetX - 1, 141),
		top: cand('top', 320, -offsetY - 1),
		right: cand('right', AREA.width - 72 - offsetX + 1, 141),
		bottom: cand('bottom', 320, AREA.height - h - offsetY + 1),
	};
	Object.entries(edges).forEach(([edge, c]) => {
		assert.deepEqual(placeCandidates([c], identity, [0, 0], AREA), [], `a label past the ${edge} edge must be dropped`);
	});
});

test('placeCandidates never moves a candidate to make it fit', () => {
	// v8 coerced off-map cities onto the edge, drawing them where they are not
	const placed = placeCandidates([cand('in', 320, 141), cand('out', 900, 141)], identity, [0, 0], AREA);
	assert.deepEqual(placed.map((c) => [c.id, c.xy.x]), [['in', 320]]);
});

test('placeCandidates drops a candidate the projection cannot place', () => {
	const broken = { forward: () => [Number.NaN, 10] };
	assert.deepEqual(placeCandidates([cand('a', 1, 1)], broken, [0, 0], AREA), []);
});

test('linearProjection reproduces the 7.4.0 Alaska map position for Anchorage', () => {
	const ak = linearProjection(STATE_MAPS.AK);
	const [x, y] = ak.forward([-149.9003, 61.2181]);
	// 7.4.0: x = (lon + 175) * 25, y = (73 - lat) * 56, drawn at 4/3
	assert.ok(Math.abs(x - ((-149.9003 + 175) * 25 * (4 / 3))) < 1e-9);
	assert.ok(Math.abs(y - ((73 - 61.2181) * 56 * (4 / 3))) < 1e-9);
});

test('linearProjection inverse undoes forward', () => {
	const hi = linearProjection(STATE_MAPS.HI);
	const [lon, lat] = hi.inverse(hi.forward([-157.8583, 21.3069]));
	assert.ok(Math.abs(lon - -157.8583) < 1e-9 && Math.abs(lat - 21.3069) < 1e-9);
});

// the projections are only right for the exact images they were measured against
test('STATE_MAPS image sizes match the PNGs on disk', () => {
	Object.entries(STATE_MAPS).forEach(([state, map]) => {
		const png = readFileSync(new URL(`../../server/${map.image}`, import.meta.url));
		assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [map.width, map.height], `${state}: ${map.image}`);
	});
});
