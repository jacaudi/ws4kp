// Pure, browser-free regional-forecast selection + projection helpers.
// Imports only other pure modules so it can be unit-tested under `node --test`.

import { geoDistance } from './utils/calc.mjs';

// Basemap projection px/deg — the SAME source values as getXYFromLatitudeLongitude
// (CONUS/HI y=55.2, x=41.775; AK y=56, x=25 — see regionalforecast-utils.mjs).
const projectionPxPerDeg = (state) => (state === 'AK'
	? { lon: 25, lat: 56 }
	: { lon: 41.775, lat: 55.2 });

// Markers live in .location-container (a sibling of .map, NOT scaled by the CSS
// transform), so their on-screen px/deg = basemap px/deg * scale. This single-sources
// the marker projection against the map transform and removes the 57/70 drift.
// Returns undefined when the city falls outside the drawable area. It used to
// clamp instead (y = 30, x = maxX, ...), which pinned off-map cities to the
// border and drew them at coordinates that were simply wrong — a label sitting on
// the edge claiming to be a place that is not there. Callers must treat undefined
// as "not drawable" and drop the candidate.
const getXYForCity = (city, maxLat, minLon, state, scale, maxX = 580, maxY = 282) => {
	const px = projectionPxPerDeg(state);
	const x = (city.lon - minLon) * px.lon * scale;
	const y = (maxLat - city.lat) * px.lat * scale;

	if (y < 30 || y > maxY) return undefined;
	if (x < 40 || x > maxX) return undefined;

	return { x, y };
};

// Junk filter: keep baked cities always; drop stations with priority >= 50
// (50 = weather/monitoring station, 99 = unknown/non-town). Missing priority = junk.
const filterJunkStations = (candidates) => candidates
	.filter((c) => c.baked || (c.priority ?? 99) < 50);

// near-tie epsilon for the distance rank (geoDistance units, ~degrees)
const RANK_EPSILON = 0.02;

// coarse visible-window prefilter; keeps the existing asymmetric right-edge fudge
const inVisibleWindow = (city, mm) => city.lat > mm.minLat
	&& city.lat < mm.maxLat
	&& city.lon > mm.minLon
	&& city.lon < mm.maxLon - 1;

// rank nearest-to-user, dedup by minSpacing (uniform in geo distance), cap at count.
// Distance dominates; baked-then-priority breaks near-ties only (never re-centers the map).
const selectRegionalCities = (user, candidates, { count, minSpacing }) => {
	const ranked = [...candidates].sort((a, b) => {
		const da = geoDistance(user.lon, user.lat, a.lon, a.lat);
		const db = geoDistance(user.lon, user.lat, b.lon, b.lat);
		if (Math.abs(da - db) > RANK_EPSILON) return da - db;
		if (a.baked !== b.baked) return a.baked ? -1 : 1;
		return (a.priority ?? 99) - (b.priority ?? 99);
	});

	const accepted = [];
	for (let i = 0; i < ranked.length && accepted.length < count; i += 1) {
		const c = ranked[i];
		const okToAdd = accepted
			.every((o) => geoDistance(c.lon, c.lat, o.lon, o.lat) >= minSpacing);
		if (okToAdd) accepted.push(c);
	}
	return accepted;
};

// window-scaled selection params. minSpacing is the real density control (design #2);
// counts are upper caps. wide/portrait minSpacing values are tunable starting points.
const regionalSelectionConfig = (wide, portrait) => {
	if (portrait) return { count: 28, minSpacing: 0.75 };
	if (wide) return { count: 22, minSpacing: 0.85 };
	return { count: 16, minSpacing: 1.0 };
};

// rectangle overlap with a small pad so a bare kiss is tolerated (only real overlaps drop)
const rectsOverlap = (a, b, pad) => a.left < b.right - pad
	&& a.right > b.left + pad
	&& a.top < b.bottom - pad
	&& a.bottom > b.top + pad;

// A measured rect is only usable if every edge is finite. declutterLabels builds
// its rect by unioning child boxes and skipping zero-width children, so a label
// measured before layout yields {left: Infinity, right: -Infinity, ...}. Every
// rectsOverlap test against that is false (Infinity < -Infinity - pad), which
// silently disables collision detection instead of failing loudly.
const isMeasured = (r) => !!r
	&& Number.isFinite(r.left) && Number.isFinite(r.top)
	&& Number.isFinite(r.right) && Number.isFinite(r.bottom);

// Process nearest-to-user first; drop any later label overlapping a kept one.
// Nearest-first guarantees the local/central cluster is never gutted.
//
// `obstacles` are reserved rects the labels must stay clear of (header, logo,
// title, date-time, scroll — anything drawn over the map). `bounds`, when given,
// is the drawable area; a label not fully inside it is dropped rather than left
// hanging over the edge.
const resolveLabelCollisions = (items, pad = 2, obstacles = [], bounds = undefined) => {
	const insideBounds = (r) => !bounds
		|| (r.left >= bounds.left && r.top >= bounds.top
			&& r.right <= bounds.right && r.bottom <= bounds.bottom);
	const clearOfObstacles = (r) => !obstacles.some((o) => isMeasured(o) && rectsOverlap(r, o, pad));

	const ranked = [...items]
		.filter((i) => isMeasured(i.rect) && insideBounds(i.rect) && clearOfObstacles(i.rect))
		.sort((a, b) => a.dist - b.dist);

	const kept = [];
	for (let i = 0; i < ranked.length; i += 1) {
		const item = ranked[i];
		const collides = kept.some((k) => rectsOverlap(item.rect, k.rect, pad));
		if (!collides) kept.push(item);
	}
	return kept;
};

export {
	projectionPxPerDeg,
	getXYForCity,
	filterJunkStations,
	inVisibleWindow,
	isMeasured,
	selectRegionalCities,
	regionalSelectionConfig,
	resolveLabelCollisions,
};
