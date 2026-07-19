import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	aqiCategory, dominantPollutant, parseAirQuality, aqiBandCenterX,
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

test('aqiBandCenterX maps each category to its band center', () => {
	assert.equal(aqiBandCenterX(45), 355.5); // GOOD
	assert.equal(aqiBandCenterX(142), 426.5); // UNHEALTHY
	assert.equal(aqiBandCenterX(250), 497.5); // VERY UNHEALTHY
	assert.equal(aqiBandCenterX(400), 568.5); // HAZARDOUS
});

test('aqiBandCenterX snaps to the band center regardless of value within the band', () => {
	// both 10 and 45 are GOOD -> same center; the bar tip does not slide within the band
	assert.equal(aqiBandCenterX(10), 355.5);
	assert.equal(aqiBandCenterX(45), 355.5);
	// above 500 clamps to HAZARDOUS center
	assert.equal(aqiBandCenterX(999), 568.5);
});
