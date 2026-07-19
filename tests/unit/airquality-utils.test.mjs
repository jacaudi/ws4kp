import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aqiCategory } from '../../server/scripts/modules/airquality-utils.mjs';

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
