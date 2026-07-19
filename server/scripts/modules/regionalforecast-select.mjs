// Pure, browser-free regional-forecast selection + projection helpers.
// Imports only other pure modules so it can be unit-tested under `node --test`.

// Basemap projection px/deg — the SAME source values as getXYFromLatitudeLongitude
// (CONUS/HI y=55.2, x=41.775; AK y=56, x=25 — see regionalforecast-utils.mjs).
const projectionPxPerDeg = (state) => (state === 'AK'
	? { lon: 25, lat: 56 }
	: { lon: 41.775, lat: 55.2 });

// Markers live in .location-container (a sibling of .map, NOT scaled by the CSS
// transform), so their on-screen px/deg = basemap px/deg * scale. This single-sources
// the marker projection against the map transform and removes the 57/70 drift.
const getXYForCity = (city, maxLat, minLon, state, scale, maxX = 580, maxY = 282) => {
	const px = projectionPxPerDeg(state);
	let x = (city.lon - minLon) * px.lon * scale;
	let y = (maxLat - city.lat) * px.lat * scale;

	if (y < 30) y = 30;
	if (y > maxY) y = maxY;

	if (x < 40) x = 40;
	if (x > maxX) x = maxX;

	return { x, y };
};

export {
	projectionPxPerDeg,
	getXYForCity,
};
