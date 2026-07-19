// wind direction
const directionToNSEW = (Direction) => {
	// Handle null, undefined, or invalid direction values
	if (Direction === null || Direction === undefined || typeof Direction !== 'number' || Number.isNaN(Direction)) {
		return 'VAR'; // Variable (or unknown) direction
	}
	const val = Math.floor((Direction / 22.5) + 0.5);
	const arr = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	return arr[(val % 16)];
};

const distance = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

// equirectangular approximation — km-proportional, cheap, no per-pair haversine trig
const geoDistance = (lon1, lat1, lon2, lat2) => {
	const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
	const dx = (lon2 - lon1) * Math.cos(midLat);
	const dy = lat2 - lat1;
	return Math.sqrt((dx * dx) + (dy * dy));
};

// wrap a number to 0-m
const wrap = (x, m) => ((x % m) + m) % m;

export {
	directionToNSEW,
	distance,
	geoDistance,
	wrap,
};
