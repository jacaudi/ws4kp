import { getTimes, getMoonTimes } from '../vendor/auto/suncalc.js';

// without a UTC offset suncalc picks the solar day nearest the instant, which runs from
// solar midnight, not local midnight. Where solar noon is well after 12:00 (up to 3pm in
// western Alaska) the first hours after midnight resolve to yesterday. day.offset (luxon,
// minutes east of UTC) pins both scans to the location's calendar day.
const sunTimesForDay = (day, latitude, longitude) => getTimes(day.toJSDate(), latitude, longitude, 0, day.offset);
const moonTimesForDay = (day, latitude, longitude) => getMoonTimes(day.toJSDate(), latitude, longitude, day.offset);

export {
	sunTimesForDay,
	moonTimesForDay,
};
