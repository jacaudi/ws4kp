import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	aqiCategory, parseAirQuality, aqiBandCenterX, pollutantRows,
} from '../../server/scripts/modules/airquality-utils.mjs';

// the six US EPA categories, each boundary from both sides, in EPA's colors
// (https://www.airnow.gov/aqi/aqi-basics/)
const EDGES = [
	[0, 'GOOD', '#00E400'],
	[50, 'GOOD', '#00E400'],
	[51, 'MODERATE', '#FFFF00'],
	[100, 'MODERATE', '#FFFF00'],
	[101, 'SENSITIVE', '#FF7E00'],
	[150, 'SENSITIVE', '#FF7E00'],
	[151, 'UNHEALTHY', '#FF0000'],
	[200, 'UNHEALTHY', '#FF0000'],
	[201, 'VERY UNHEALTHY', '#8F3F97'],
	[300, 'VERY UNHEALTHY', '#8F3F97'],
	[301, 'HAZARDOUS', '#7E0023'],
	[500, 'HAZARDOUS', '#7E0023'],
];
EDGES.forEach(([aqi, category, color]) => {
	test(`AQI ${aqi} is ${category}`, () => {
		const band = aqiCategory(aqi);
		assert.equal(band.category, category);
		assert.equal(band.color, color);
	});
});

test('AQI above 500 clamps to HAZARDOUS', () => {
	assert.equal(aqiCategory(999).category, 'HAZARDOUS');
});

test('negative AQI maps to GOOD', () => {
	assert.equal(aqiCategory(-5).category, 'GOOD');
});

// the chart shows PM2.5's own AQI, not the overall index (the worst of all pollutants)
test('parseAirQuality charts the PM2.5 AQI', () => {
	const raw = {
		current: {
			us_aqi_pm2_5: 63.4,
			us_aqi_pm10: 40,
			us_aqi_ozone: 155,
			us_aqi_nitrogen_dioxide: 12,
			pm2_5: 17.2,
			pm10: 22.0,
			ozone: 88.0,
			nitrogen_dioxide: 9.4,
		},
	};
	const result = parseAirQuality(raw);
	assert.equal(result.aqi, 63); // rounded PM2.5 AQI; ozone's 155 does not drive the chart
	assert.equal(result.category.category, 'MODERATE');
	assert.equal(result.current.pm2_5, 17.2);
});

test('parseAirQuality returns null for missing current block', () => {
	assert.equal(parseAirQuality({}), null);
	assert.equal(parseAirQuality(null), null);
});

test('parseAirQuality returns null when the PM2.5 AQI is missing or not a number', () => {
	[null, undefined, 'not a number', NaN].forEach((value) => {
		assert.equal(parseAirQuality({ current: { us_aqi_pm2_5: value, us_aqi_ozone: 40 } }), null, String(value));
	});
});

// the six columns are SPC Outlook's: 220-340, then 60px each to 640
test('aqiBandCenterX maps each category to the center of its visible column', () => {
	assert.equal(aqiBandCenterX(45), 280); // GOOD 220-340
	assert.equal(aqiBandCenterX(75), 370); // MODERATE 340-400
	assert.equal(aqiBandCenterX(125), 430); // SENSITIVE 400-460
	assert.equal(aqiBandCenterX(175), 490); // UNHEALTHY 460-520
	assert.equal(aqiBandCenterX(250), 550); // VERY UNHEALTHY 520-580
	assert.equal(aqiBandCenterX(400), 610); // HAZARDOUS 580-640
});

test('aqiBandCenterX snaps to the band center regardless of value within the band', () => {
	// both 10 and 45 are GOOD -> same center; the bar tip does not slide within the band
	assert.equal(aqiBandCenterX(10), 280);
	assert.equal(aqiBandCenterX(45), 280);
	// above 500 clamps to HAZARDOUS center
	assert.equal(aqiBandCenterX(999), 610);
});

// portrait detail box: one row per pollutant, in POLLUTANT_LABELS order
const sample = {
	us_aqi: 21,
	us_aqi_pm2_5: 12.4,
	us_aqi_pm10: 5,
	us_aqi_ozone: 21,
	us_aqi_nitrogen_dioxide: 2,
	pm2_5: 3.44,
	pm10: 7.1,
	ozone: 45.25,
	nitrogen_dioxide: 3,
};

test('pollutantRows lists each pollutant with its AQI and concentration', () => {
	assert.deepEqual(pollutantRows(sample).map(({ label, aqi, concentration }) => [label, aqi, concentration]), [
		['PM2.5', '12', '3.4'],
		['PM10', '5', '7.1'],
		['O₃', '21', '45.3'],
		['NO₂', '2', '3.0'],
	]);
});

test('pollutantRows shows a dash for a value Open-Meteo did not report', () => {
	const row = pollutantRows({ ...sample, us_aqi_pm10: null, pm10: undefined }).find((r) => r.label === 'PM10');
	assert.deepEqual([row.aqi, row.concentration], ['-', '-']);
});
