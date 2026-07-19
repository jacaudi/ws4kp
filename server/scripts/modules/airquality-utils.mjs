// Pure, browser-free Air Quality helpers — importable by the display AND by node --test.
// No window/document/DOM references may be added to this file; keep it pure.

// AQI band -> { category, color, cssClass } lookup — MVP 4-band scale, health-protective:
// GOOD capped at EPA "Good" (0-50); EPA "Moderate" (51-100) is bumped up to UNHEALTHY.
// Colors are the twc3 palette reproduced in the mockup.
export const AQI_BANDS = [
	{
		max: 50, category: 'GOOD', color: '#FFFF00', cssClass: 'aqi-good',
	},
	{
		max: 200, category: 'UNHEALTHY', color: '#FFB000', cssClass: 'aqi-unhealthy',
	},
	{
		max: 300, category: 'VERY UNHEALTHY', color: '#FF8000', cssClass: 'aqi-very-unhealthy',
	},
	{
		max: 500, category: 'HAZARDOUS', color: '#FF0000', cssClass: 'aqi-hazardous',
	},
];

// Map a US-AQI value to its band. Values above the last band clamp to HAZARDOUS.
export const aqiCategory = (aqi) => AQI_BANDS.find((band) => aqi <= band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
