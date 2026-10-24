// Pure, browser-free Air Quality helpers — importable by the display AND by node --test.
// No window/document/DOM references may be added to this file; keep it pure.

// AQI band -> { category, color, cssClass }: the six US EPA categories and EPA's colors
// (https://www.airnow.gov/aqi/aqi-basics/). "Unhealthy for Sensitive Groups" is labelled SENSITIVE:
// the full name does not fit a band's label row.
export const AQI_BANDS = [
	{
		max: 50, category: 'GOOD', color: '#00E400', cssClass: 'aqi-good',
	},
	{
		max: 100, category: 'MODERATE', color: '#FFFF00', cssClass: 'aqi-moderate',
	},
	{
		max: 150, category: 'SENSITIVE', color: '#FF7E00', cssClass: 'aqi-sensitive',
	},
	{
		max: 200, category: 'UNHEALTHY', color: '#FF0000', cssClass: 'aqi-unhealthy',
	},
	{
		max: 300, category: 'VERY UNHEALTHY', color: '#8F3F97', cssClass: 'aqi-very-unhealthy',
	},
	{
		max: 500, category: 'HAZARDOUS', color: '#7E0023', cssClass: 'aqi-hazardous',
	},
];

// Map a US-AQI value to its band. Values above the last band clamp to HAZARDOUS.
export const aqiCategory = (aqi) => AQI_BANDS.find((band) => aqi <= band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];

// Open-Meteo sub-index key -> display label, in the portrait table's row order.
export const POLLUTANT_LABELS = {
	us_aqi_pm2_5: 'PM2.5',
	us_aqi_pm10: 'PM10',
	us_aqi_ozone: 'O₃',
	us_aqi_nitrogen_dioxide: 'NO₂',
};

// Portrait detail rows: each pollutant's own AQI and its concentration in µg/m³, in
// POLLUTANT_LABELS order. Open-Meteo names the concentration as the sub-index key without its
// "us_aqi_" prefix. A value it did not report shows as a dash.
export const pollutantRows = (current) => Object.entries(POLLUTANT_LABELS).map(([key, label]) => {
	const aqi = current?.[key];
	const concentration = current?.[key.replace('us_aqi_', '')];
	return {
		label,
		aqi: typeof aqi === 'number' && Number.isFinite(aqi) ? Math.round(aqi).toString() : '-',
		concentration: typeof concentration === 'number' && Number.isFinite(concentration) ? concentration.toFixed(1) : '-',
	};
});

// Normalize an Open-Meteo response into the shape drawCanvas consumes, or null to self-disable.
// The chart shows PM2.5's own AQI, not the overall index (the worst of all the pollutants); the
// portrait table lists every pollutant. No PM2.5 AQI means nothing to chart.
export const parseAirQuality = (raw) => {
	const current = raw?.current;
	const pm25 = current?.us_aqi_pm2_5;
	if (typeof pm25 !== 'number' || !Number.isFinite(pm25)) return null;
	const aqi = Math.round(pm25);
	return {
		aqi,
		category: aqiCategory(aqi),
		current,
	};
};

// Growing-bar tip x: the horizontal CENTER of the value's category column (the bar stops here,
// as SPC Outlook's do). The edges are the visible columns of SPC Outlook's six-band staircase,
// measured from its background (6.png): 220-340, then 60px each to 640. They are the single source
// for the band geometry (airquality.mjs) as well as the tip, and the band is chosen by aqiCategory
// so the breakpoints and the centers can never drift apart.
export const BAND_EDGES = [220, 340, 400, 460, 520, 580, 640];
export const aqiBandCenterX = (usAqi) => {
	const index = AQI_BANDS.indexOf(aqiCategory(usAqi));
	return (BAND_EDGES[index] + BAND_EDGES[index + 1]) / 2;
};
