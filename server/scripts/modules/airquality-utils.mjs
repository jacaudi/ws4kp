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

// Open-Meteo sub-index key -> display label. Order is not significant (argmax below).
export const POLLUTANT_LABELS = {
	us_aqi_pm2_5: 'PM2.5',
	us_aqi_pm10: 'PM10',
	us_aqi_ozone: 'O₃',
	us_aqi_nitrogen_dioxide: 'NO₂',
};

// argmax over the us_aqi_* sub-indices; Open-Meteo has no named "dominant pollutant" field.
export const dominantPollutant = (current) => {
	let bestKey = null;
	let bestValue = -Infinity;
	Object.keys(POLLUTANT_LABELS).forEach((key) => {
		const value = current?.[key];
		if (typeof value === 'number' && value > bestValue) {
			bestValue = value;
			bestKey = key;
		}
	});
	return bestKey ? POLLUTANT_LABELS[bestKey] : null;
};

// Normalize an Open-Meteo response into the shape drawCanvas consumes, or null to self-disable.
export const parseAirQuality = (raw) => {
	const current = raw?.current;
	if (!current || current.us_aqi == null || !Number.isFinite(current.us_aqi)) return null;
	const aqi = Math.round(current.us_aqi);
	return {
		aqi,
		category: aqiCategory(aqi),
		dominant: dominantPollutant(current),
		current,
	};
};

// Growing-bar tip x: the horizontal CENTER of the value's category band (the bar stops here).
// Equal-width legend band edges (px) are the single source; the band is chosen by
// aqiCategory so the breakpoints and the centers can never drift apart.
const BAND_EDGES = [320, 391, 462, 533, 604];
export const aqiBandCenterX = (usAqi) => {
	const index = AQI_BANDS.indexOf(aqiCategory(usAqi));
	return (BAND_EDGES[index] + BAND_EDGES[index + 1]) / 2;
};
