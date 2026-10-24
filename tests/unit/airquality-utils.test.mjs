import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	aqiCategory, dominantPollutant, parseAirQuality, aqiBandCenterX, pollutantRows,
} from '../../server/scripts/modules/airquality-utils.mjs';

test('AQI 0 is GOOD', () => {
	assert.equal(aqiCategory(0).category, 'GOOD');
});

test('AQI 50 is GOOD (upper edge of GOOD)', () => {
	const band = aqiCategory(50);
	assert.equal(band.category, 'GOOD');
	assert.equal(band.color, '#FFFF00');
	assert.equal(band.cssClass, 'aqi-good');
});

test('AQI 51 is UNHEALTHY (EPA Moderate bumps up, health-protective)', () => {
	assert.equal(aqiCategory(51).category, 'UNHEALTHY');
});

test('AQI 75 is UNHEALTHY (not GOOD — deviates from twc3 <=100)', () => {
	assert.equal(aqiCategory(75).category, 'UNHEALTHY');
});

test('AQI 200 is UNHEALTHY (upper edge)', () => {
	const band = aqiCategory(200);
	assert.equal(band.category, 'UNHEALTHY');
	assert.equal(band.color, '#FFB000');
});

test('AQI 201 is VERY UNHEALTHY', () => {
	const band = aqiCategory(201);
	assert.equal(band.category, 'VERY UNHEALTHY');
	assert.equal(band.color, '#FF8000');
});

test('AQI 300 is VERY UNHEALTHY (upper edge)', () => {
	assert.equal(aqiCategory(300).category, 'VERY UNHEALTHY');
});

test('AQI 301 is HAZARDOUS', () => {
	const band = aqiCategory(301);
	assert.equal(band.category, 'HAZARDOUS');
	assert.equal(band.color, '#FF0000');
});

test('AQI 500 is HAZARDOUS (upper edge)', () => {
	assert.equal(aqiCategory(500).category, 'HAZARDOUS');
});

test('AQI 999 clamps to HAZARDOUS', () => {
	assert.equal(aqiCategory(999).category, 'HAZARDOUS');
});

test('negative AQI maps to GOOD', () => {
	assert.equal(aqiCategory(-5).category, 'GOOD');
});

test('dominantPollutant picks the highest us_aqi_* sub-index', () => {
	const current = {
		us_aqi_pm2_5: 63, us_aqi_pm10: 40, us_aqi_ozone: 55, us_aqi_nitrogen_dioxide: 12,
	};
	assert.equal(dominantPollutant(current), 'PM2.5');
});

test('dominantPollutant returns O₃ when ozone leads', () => {
	const current = {
		us_aqi_pm2_5: 30, us_aqi_pm10: 20, us_aqi_ozone: 88, us_aqi_nitrogen_dioxide: 12,
	};
	assert.equal(dominantPollutant(current), 'O₃');
});

test('dominantPollutant ignores missing/null fields', () => {
	const current = { us_aqi_pm2_5: 10, us_aqi_ozone: null };
	assert.equal(dominantPollutant(current), 'PM2.5');
});

test('dominantPollutant returns null when no sub-indices are numeric', () => {
	assert.equal(dominantPollutant({ us_aqi: 42 }), null);
	assert.equal(dominantPollutant({}), null);
});

test('parseAirQuality normalizes a full response', () => {
	const raw = {
		current: {
			us_aqi: 63.4,
			us_aqi_pm2_5: 63, us_aqi_pm10: 40, us_aqi_ozone: 55, us_aqi_nitrogen_dioxide: 12,
			pm2_5: 17.2, pm10: 22.0, ozone: 88.0, nitrogen_dioxide: 9.4,
		},
	};
	const result = parseAirQuality(raw);
	assert.equal(result.aqi, 63); // rounded
	assert.equal(result.category.category, 'UNHEALTHY');
	assert.equal(result.dominant, 'PM2.5');
	assert.equal(result.current.pm2_5, 17.2);
});

test('parseAirQuality returns null for missing current block', () => {
	assert.equal(parseAirQuality({}), null);
	assert.equal(parseAirQuality(null), null);
});

test('parseAirQuality returns null when us_aqi is null', () => {
	assert.equal(parseAirQuality({ current: { us_aqi: null } }), null);
});

test('parseAirQuality returns null when us_aqi is not a number', () => {
	assert.equal(parseAirQuality({ current: { us_aqi: 'not a number' } }), null);
});

test('parseAirQuality returns null when us_aqi is NaN', () => {
	assert.equal(parseAirQuality({ current: { us_aqi: NaN } }), null);
});

// columns follow SPC Outlook's staircase: a 120px first column, then 60px each, ending at 640
test('aqiBandCenterX maps each category to the center of its visible column', () => {
	assert.equal(aqiBandCenterX(45), 400); // GOOD 340-460
	assert.equal(aqiBandCenterX(142), 490); // UNHEALTHY 460-520
	assert.equal(aqiBandCenterX(250), 550); // VERY UNHEALTHY 520-580
	assert.equal(aqiBandCenterX(400), 610); // HAZARDOUS 580-640
});

test('aqiBandCenterX snaps to the band center regardless of value within the band', () => {
	// both 10 and 45 are GOOD -> same center; the bar tip does not slide within the band
	assert.equal(aqiBandCenterX(10), 400);
	assert.equal(aqiBandCenterX(45), 400);
	// above 500 clamps to HAZARDOUS center
	assert.equal(aqiBandCenterX(999), 610);
});

// portrait detail box: one row per pollutant, in POLLUTANT_LABELS order
const sample = {
	us_aqi: 21,
	us_aqi_pm2_5: 12.4, us_aqi_pm10: 5, us_aqi_ozone: 21, us_aqi_nitrogen_dioxide: 2,
	pm2_5: 3.44, pm10: 7.1, ozone: 45.25, nitrogen_dioxide: 3,
};

test('pollutantRows lists each pollutant with its AQI and concentration', () => {
	assert.deepEqual(pollutantRows(sample).map(({ label, aqi, concentration }) => [label, aqi, concentration]), [
		['PM2.5', '12', '3.4'],
		['PM10', '5', '7.1'],
		['O₃', '21', '45.3'],
		['NO₂', '2', '3.0'],
	]);
});

test('pollutantRows colors each AQI by its own category', () => {
	const rows = pollutantRows({ ...sample, us_aqi_ozone: 150 });
	assert.equal(rows.find((r) => r.label === 'O₃').color, aqiCategory(150).color);
	assert.equal(rows.find((r) => r.label === 'PM10').color, aqiCategory(5).color);
});

test('pollutantRows shows a dash for a value Open-Meteo did not report', () => {
	const row = pollutantRows({ ...sample, us_aqi_pm10: null, pm10: undefined }).find((r) => r.label === 'PM10');
	assert.deepEqual([row.aqi, row.concentration, row.color], ['-', '-', undefined]);
});
