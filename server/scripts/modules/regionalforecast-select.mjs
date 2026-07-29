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

// Degrees added to a STATION's effective rank distance so named cities win contested
// slots. Upstream instead inflates a station's collision box 1.7x, but that policy
// does not transfer here: stations outnumber baked cities roughly 7:1, so making each
// one occupy more space cuts the total label count below what ships today. A rank
// penalty changes WHICH candidate takes a slot without consuming any extra space.
//
// 0.75 deg is the measured knee. Below it a station 0.03 deg nearer still beats a real
// metro (Milwaukee lost to Racine at 0.5); results are flat from 0.75 to 1.0, so this
// is not knife-edge tuned. It stays well under the distance at which a remote city
// would outrank a genuinely local station, which sparse regions depend on.
const STATION_RANK_PENALTY = 0.75;

// rectangle overlap with a small pad so a bare kiss is tolerated (only real overlaps drop)
const rectsOverlap = (a, b, pad) => a.left < b.right - pad
	&& a.right > b.left + pad
	&& a.top < b.bottom - pad
	&& a.bottom > b.top + pad;

// px of tolerance for the post-render declutter pass, whose rects come from
// getBoundingClientRect and carry sub-pixel noise; without it a label that merely abuts
// its neighbour would be deleted. Selection deliberately does NOT use this — see
// selectRegionalCities.
const LABEL_PAD = 2;

// Rendered label geometry in CSS px, measured from the live DOM and pinned by
// _regional-forecast.scss: .location carries margin-left -40 / margin-top -35, and its
// children (city text, icon at top 26 h32, temp at top 28) span 62px vertically.
// Width measures 83-114px depending on name length; 95 is the midpoint, and the
// post-render declutter pass re-tests with REAL measured boxes, so an under-estimate
// here costs at most one label rather than producing an overlap.
//
// Spacing is expressed in pixels rather than degrees because labels are wide and short
// while the projection is not: ~55.7 px per degree of longitude against 73.6 per degree
// of latitude. A single isotropic degree threshold is therefore simultaneously too
// loose horizontally (neighbours pass selection, then collide and get decluttered away)
// and too tight vertically (stacked pairs are rejected with room to spare). The box is
// identical in every display mode, and all three modes share the same projection scale,
// so this needs no per-mode tuning.
const LABEL_BOX = {
	w: 95, h: 62, offsetX: -40, offsetY: -35,
};

// The label rect a candidate would occupy, or undefined when it cannot be placed.
// A candidate reaches selection with an xy attached by regionalforecast.mjs; a missing
// or non-finite one must mean "unusable", never "overlaps nothing" — treating a
// degenerate box as collision-free is exactly what silently disabled decluttering.
const labelBox = (candidate) => {
	const xy = candidate?.xy;
	if (!xy || !Number.isFinite(xy.x) || !Number.isFinite(xy.y)) return undefined;
	const left = xy.x + LABEL_BOX.offsetX;
	const top = xy.y + LABEL_BOX.offsetY;
	return {
		left, top, right: left + LABEL_BOX.w, bottom: top + LABEL_BOX.h,
	};
};

// coarse visible-window prefilter; keeps the existing asymmetric right-edge fudge
const inVisibleWindow = (city, mm) => city.lat > mm.minLat
	&& city.lat < mm.maxLat
	&& city.lon > mm.minLon
	&& city.lon < mm.maxLon - 1;

// Rank nearest-first, then keep a candidate only if its label box clears every box
// already kept, capped at count. Candidates must arrive with the projected xy that
// regionalforecast.mjs attaches; one without a usable xy cannot be placed and is skipped.
//
// Distance dominates the rank, offset by STATION_RANK_PENALTY so stations yield to named
// cities; baked-then-priority still breaks what remains a near-tie. Selection never
// re-centers the map.
//
// Spacing against the real label footprint is what makes the count meaningful. The old
// degree threshold admitted horizontal neighbours that the post-render declutter pass
// then deleted, so a window could select 7 labels and render 4; selecting against the
// same collision model decluttering uses means a chosen label is one that survives.
const selectRegionalCities = (user, candidates, { count }) => {
	const effectiveDistance = (c) => geoDistance(user.lon, user.lat, c.lon, c.lat)
		+ (c.baked ? 0 : STATION_RANK_PENALTY);

	const ranked = [...candidates].sort((a, b) => {
		const da = effectiveDistance(a);
		const db = effectiveDistance(b);
		if (Math.abs(da - db) > RANK_EPSILON) return da - db;
		if (a.baked !== b.baked) return a.baked ? -1 : 1;
		return (a.priority ?? 99) - (b.priority ?? 99);
	});

	// Pad 0: boxes must not overlap, but they MAY abut. LABEL_PAD is the declutter pass's
	// tolerance for sub-pixel noise in rects measured off the live DOM; there is no such
	// noise in a computed box, so spending it here would only cost labels.
	//
	// Abutting is deliberate. Requiring a real gap instead was measured to cost a label in
	// exactly the windows that need one most — Tampa drops 5 to 4, Chicago 14 to 12 —
	// because sparse coastal candidates stack vertically and the label height is the
	// binding dimension. The cost of allowing it is that two labels exactly LABEL_BOX.h
	// apart can graze by a fraction of a pixel once layout rounds their real positions,
	// which varies with viewport scale. That contact is between the bottom of one label's
	// temperature digits and the top of the next label's city text, neither of which fills
	// its box, so it is invisible; the declutter pass treats the same 2px as a bare kiss
	// and leaves it alone. Verified across seven locations with zero touching pairs.
	const accepted = [];
	const keptBoxes = [];
	for (let i = 0; i < ranked.length && accepted.length < count; i += 1) {
		const box = labelBox(ranked[i]);
		if (box && keptBoxes.every((kept) => !rectsOverlap(box, kept, 0))) {
			accepted.push(ranked[i]);
			keptBoxes.push(box);
		}
	}
	return accepted;
};

// Per-mode upper caps. These bound cost as much as clutter — every selected city costs
// two NWS requests — while LABEL_BOX does the actual density work. Spacing used to live
// here as a per-mode minSpacing, but that was a degree-valued proxy for a pixel
// constraint; measuring in pixels against a label box that is identical in every mode,
// under a projection scale that is also identical, removes the per-mode tuning entirely.
const regionalSelectionConfig = (wide, portrait) => {
	if (portrait) return { count: 28 };
	if (wide) return { count: 22 };
	return { count: 16 };
};

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
const resolveLabelCollisions = (items, pad = LABEL_PAD, obstacles = [], bounds = undefined) => {
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
	LABEL_BOX,
	LABEL_PAD,
	STATION_RANK_PENALTY,
	projectionPxPerDeg,
	getXYForCity,
	filterJunkStations,
	inVisibleWindow,
	isMeasured,
	selectRegionalCities,
	regionalSelectionConfig,
	resolveLabelCollisions,
};
