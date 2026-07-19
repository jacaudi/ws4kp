// Pure, browser-free regional-forecast selection + projection helpers.
// Imports only other pure modules so it can be unit-tested under `node --test`.

const getXYForCity = (city, maxLat, minLon, state, maxX = 580, maxY = 282) => {
	if (state === 'AK') return getXYForCityAK(city, maxLat, minLon);
	if (state === 'HI') return getXYForCityHI(city, maxLat, minLon);
	let x = (city.lon - minLon) * 57;
	let y = (maxLat - city.lat) * 70;

	if (y < 30) y = 30;
	if (y > maxY) y = maxY;

	if (x < 40) x = 40;
	if (x > maxX) x = maxX;

	return { x, y };
};

const getXYForCityAK = (city, maxLat, minLon) => {
	let x = (city.lon - minLon) * 37;
	let y = (maxLat - city.lat) * 70;

	if (y < 30) y = 30;
	if (y > 282) y = 282;

	if (x < 40) x = 40;
	if (x > 580) x = 580;
	return { x, y };
};

const getXYForCityHI = (city, maxLat, minLon) => {
	let x = (city.lon - minLon) * 57;
	let y = (maxLat - city.lat) * 70;

	if (y < 30) y = 30;
	if (y > 282) y = 282;

	if (x < 40) x = 40;
	if (x > 580) x = 580;

	return { x, y };
};

export {
	// eslint-disable-next-line import/prefer-default-export
	getXYForCity,
};
