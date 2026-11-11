import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compareCounts, mergeCounts, parseDiagnostics, totalOf,
} from '../../scripts/tsc-ratchet.mjs';

const output = [
	"server/scripts/index.mjs(10,5): error TS2339: Property 'style' does not exist on type 'Element'.",
	"server/scripts/index.mjs(12,5): error TS2339: Property 'value' does not exist on type 'Element'.",
	"server/scripts/modules/media.mjs(3,1): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
	"  Type 'Promise<void>' is not assignable to type 'boolean'.",
	"server/scripts/vendor/auto/luxon.mjs(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
	'',
].join('\n');

test('tsc ratchet counts diagnostics per file and code, and ignores vendor files and continuation lines', () => {
	assert.deepEqual(parseDiagnostics(output), {
		'server/scripts/index.mjs': { TS2339: 2 },
		'server/scripts/modules/media.mjs': { TS2345: 1 },
	});
});

test('tsc ratchet refuses a diagnostic that names no file', () => {
	assert.throws(() => parseDiagnostics('error TS18003: No inputs were found in config file.\n'), /outside any file/);
});

test('tsc ratchet adds the counts of both configs', () => {
	const merged = mergeCounts({ 'a.mjs': { TS2339: 2 } }, { 'a.mjs': { TS2339: 1, TS2345: 1 }, 'b.mjs': { TS2322: 4 } });
	assert.deepEqual(merged, { 'a.mjs': { TS2339: 3, TS2345: 1 }, 'b.mjs': { TS2322: 4 } });
	assert.equal(totalOf(merged), 8);
});

test('tsc ratchet fails on a raised count or a new pair, and reports what can be lowered', () => {
	const baseline = { 'a.mjs': { TS2339: 2, TS2345: 1 }, 'gone.mjs': { TS2322: 1 } };
	assert.deepEqual(compareCounts(baseline, baseline), { raised: [], lowered: [] });
	assert.deepEqual(compareCounts({ 'a.mjs': { TS2339: 3, TS2345: 1, TS2554: 1 }, 'gone.mjs': { TS2322: 1 } }, baseline).raised, [
		{
			file: 'a.mjs', code: 'TS2339', was: 2, now: 3,
		},
		{
			file: 'a.mjs', code: 'TS2554', was: 0, now: 1,
		},
	]);
	assert.deepEqual(compareCounts({ 'a.mjs': { TS2339: 1, TS2345: 1 } }, baseline), {
		raised: [],
		lowered: [
			{
				file: 'a.mjs', code: 'TS2339', was: 2, now: 1,
			},
			{
				file: 'gone.mjs', code: 'TS2322', was: 1, now: 0,
			},
		],
	});
});
