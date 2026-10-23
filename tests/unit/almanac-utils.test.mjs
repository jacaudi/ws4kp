import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from '../../server/scripts/vendor/auto/luxon.mjs';
import { sunTimesForDay, moonTimesForDay } from '../../server/scripts/modules/almanac-utils.mjs';

// Nome, Alaska: AKDT is UTC-8 but solar noon there is about 3pm, so for the first
// ~3 hours after local midnight the solar day suncalc picks from the instant alone
// is still yesterday. The almanac's "today" column must not show yesterday's sun.
const NOME = { lat: 64.5011, lon: -165.4064, zone: 'America/Nome' };
const justAfterMidnight = DateTime.fromISO('2026-06-15T01:00', { zone: NOME.zone });

test('sun times belong to the location\'s calendar day, even just after local midnight', () => {
	// solar noon pins which day suncalc solved for; sunrise and sunset are solved around it
	const { solarNoon } = sunTimesForDay(justAfterMidnight, NOME.lat, NOME.lon);
	assert.equal(DateTime.fromJSDate(solarNoon).setZone(NOME.zone).toISODate(), '2026-06-15');
});

test('moon rise and set fall inside the location\'s calendar day', () => {
	const start = justAfterMidnight.startOf('day');
	const end = start.plus({ days: 1 });
	for (let days = 0; days < 30; days += 1) {
		const day = justAfterMidnight.plus({ days });
		const { rise, set } = moonTimesForDay(day, NOME.lat, NOME.lon);
		[rise, set].filter(Boolean).forEach((time) => {
			const t = DateTime.fromJSDate(time);
			assert.ok(t >= start.plus({ days }) && t < end.plus({ days }), `${day.toISODate()}: ${t.setZone(NOME.zone).toISO()} is outside the local day`);
		});
	}
});
