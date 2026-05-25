// regional forecast and observations
// type 0 = observations, 1 = first forecast, 2 = second forecast

import STATUS from './status.mjs';
import { distance as calcDistance } from './utils/calc.mjs';
import { safeJson, safePromiseAll } from './utils/fetch.mjs';
import { temperature as temperatureUnit } from './utils/units.mjs';
import { getSmallIcon } from './icons.mjs';
import { preloadImg } from './utils/image.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import * as utils from './regionalforecast-utils.mjs';
import { getPoint } from './utils/weather.mjs';
import { debugFlag } from './utils/debug.mjs';
import filterExpiredPeriods from './utils/forecast-utils.mjs';
import settings from './settings.mjs';

// set up spacing and scales
const scaling = () => {
	// available space
	const available = {
		x: 640,
		y: 282,
	};

	// map offset
	const mapOffsetXY = {
		x: 240,
		y: 117,
	};

	// per-mode density tuning constants
	// base: minimum spacing (°) between picks at the user's location
	// bias: radial growth factor — required spacing = base × (1 + bias × dist)
	// cap: soft total ceiling on picked cities
	// pass1: proximity-phase ceiling (pass 1a + 1b combined)
	// curatedCap: soft ceiling on curated picks in pass 1a
	// maxPass2Dist: pass 2 skips cells whose center is farther than this (°)
	// gcols/grows: grid subdivision of the bbox used by pass 2
	let base = 1.25;
	let bias = 0.35;
	let cap = 10;
	let pass1 = 7;
	let curatedCap = 3;
	let maxPass2Dist = 6.5;
	let gcols = 3;
	let grows = 3;

	if (settings.enhanced?.value) {
		if (settings.wide?.value) {
			mapOffsetXY.x = 320;
			available.x = 854;
			base = 1.00;
			cap = 14;
			pass1 = 10;
			curatedCap = 4;
			maxPass2Dist = 9.0;
			gcols = 4;
		}

		if (settings.portrait?.value) {
			mapOffsetXY.y = 400;
			available.y = 970;
			base = 0.90;
			cap = 20;
			pass1 = 12;
			curatedCap = 6;
			maxPass2Dist = 12.0;
			grows = 5;
		}
	}
	return {
		mapOffsetXY,
		available,
		base,
		bias,
		cap,
		pass1,
		curatedCap,
		maxPass2Dist,
		gcols,
		grows,
	};
};

const USER_EXCLUSION = 0.25; // ° — skip candidates co-located with the user

class RegionalForecast extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Regional Forecast', true);

		// timings
		this.timing.totalScreens = 3;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;
		// regional forecast implements a silent reload
		// but it will not fall back to previously loaded data if data can not be loaded
		// there are enough other cities available to populate the map sufficiently even if some do not load

		// pre-load the base map
		let baseMap = 'images/maps/basemap.webp';
		if (weatherParameters.state === 'HI') {
			baseMap = 'images/maps/radar-hawaii.png';
		} else if (weatherParameters.state === 'AK') {
			baseMap = 'images/maps/radar-alaska.png';
		}
		this.elem.querySelector('.map img').src = baseMap;

		// get user's location in x/y
		const {
			available, mapOffsetXY, base, bias, cap, pass1, curatedCap, maxPass2Dist, gcols, grows,
		} = scaling();
		const sourceXY = utils.getXYFromLatitudeLongitude(this.weatherParameters.latitude, this.weatherParameters.longitude, mapOffsetXY.x, mapOffsetXY.y, weatherParameters.state);

		// get latitude and longitude limits
		const minMaxLatLon = utils.getMinMaxLatitudeLongitude(sourceXY.x, sourceXY.y, mapOffsetXY.x, mapOffsetXY.y, this.weatherParameters.state);

		const userLat = this.weatherParameters.latitude;
		const userLon = this.weatherParameters.longitude;

		// tag curated entries so we can preferentially pick them in pass 1a
		const curated = RegionalCities.map((c) => ({ ...c, _src: 'curated' }));
		const stations = Object.values(StationInfo).map((s) => ({ ...s, _src: 'station' }));
		const pool = [...curated, ...stations];

		// pre-filter: bbox + user-exclusion + distance tag + cell tag + sort by distance
		const candidates = [];
		for (const c of pool) {
			if (!(c.lat > minMaxLatLon.minLat && c.lat < minMaxLatLon.maxLat
				&& c.lon > minMaxLatLon.minLon && c.lon < minMaxLatLon.maxLon - 1)) continue;
			const d = calcDistance(c.lon, c.lat, userLon, userLat);
			if (d < USER_EXCLUSION) continue;
			candidates.push({ ...c, _dist: d });
		}
		candidates.sort((a, b) => a._dist - b._dist);

		// cell helpers in lat/lon space
		const latStep = (minMaxLatLon.maxLat - minMaxLatLon.minLat) / grows;
		const lonStep = (minMaxLatLon.maxLon - minMaxLatLon.minLon) / gcols;
		const cellOf = (lat, lon) => [
			Math.min(gcols - 1, Math.floor((lon - minMaxLatLon.minLon) / lonStep)),
			Math.min(grows - 1, Math.floor((minMaxLatLon.maxLat - lat) / latStep)),
		];
		const cellCenter = (cx, cy) => ({
			lon: minMaxLatLon.minLon + (cx + 0.5) * lonStep,
			lat: minMaxLatLon.maxLat - (cy + 0.5) * latStep,
		});
		for (const c of candidates) { c._cell = cellOf(c.lat, c.lon); }

		const regionalCities = [];

		// pass 1a — curated cities first, closest-first, spacing-aware
		for (const c of candidates) {
			if (regionalCities.length >= curatedCap) break;
			if (c._src !== 'curated') continue;
			const req = base * (1 + bias * c._dist);
			const ok = regionalCities.every((p) => calcDistance(c.lon, c.lat, p.lon, p.lat) >= req);
			if (ok) regionalCities.push(c);
		}

		// pass 1b — stations fill remaining proximity slots
		for (const c of candidates) {
			if (regionalCities.length >= pass1) break;
			if (c._src === 'curated') continue;
			const req = base * (1 + bias * c._dist);
			const ok = regionalCities.every((p) => calcDistance(c.lon, c.lat, p.lon, p.lat) >= req);
			if (ok) regionalCities.push(c);
		}

		// pass 2 — gap fill: visit empty cells near the user, pick closest candidate to cell center
		const userCell = cellOf(userLat, userLon);
		const filled = new Set(regionalCities.map((p) => p._cell.join(',')));
		const empty = [];
		for (let cx = 0; cx < gcols; cx++) {
			for (let cy = 0; cy < grows; cy++) {
				if (filled.has(`${cx},${cy}`)) continue;
				const cc = cellCenter(cx, cy);
				const cellDist = calcDistance(cc.lon, cc.lat, userLon, userLat);
				if (cellDist > maxPass2Dist) continue;
				empty.push([cx, cy]);
			}
		}
		empty.sort((a, b) =>
			(Math.abs(a[0] - userCell[0]) + Math.abs(a[1] - userCell[1]))
			- (Math.abs(b[0] - userCell[0]) + Math.abs(b[1] - userCell[1])));

		for (const [cx, cy] of empty) {
			if (regionalCities.length >= cap) break;
			const cc = cellCenter(cx, cy);
			const inCell = candidates
				.filter((c) => !regionalCities.includes(c) && c._cell[0] === cx && c._cell[1] === cy)
				.map((c) => ({ c, _distToCenter: calcDistance(c.lon, c.lat, cc.lon, cc.lat) }))
				.sort((a, b) => a._distToCenter - b._distToCenter);
			for (const { c } of inCell) {
				const req = base * (1 + bias * c._dist) * 0.7;
				if (regionalCities.every((p) => calcDistance(c.lon, c.lat, p.lon, p.lat) >= req)) {
					regionalCities.push(c);
					break;
				}
			}
		}

		// get a unit converter
		const temperatureConverter = temperatureUnit();

		// get regional forecasts and observations using centralized safe Promise handling
		const regionalDataAll = await safePromiseAll(regionalCities.map(async (city) => {
			try {
				const point = city?.point ?? (await getAndFormatPoint(city.lat, city.lon));
				if (!point) {
					if (debugFlag('verbose-failures')) {
						console.warn(`Unable to get Points for '${city.Name ?? city.city}'`);
					}
					return false;
				}

				// start off the observation task
				const observationPromise = utils.getRegionalObservation(point, city);

				const forecast = await safeJson(`https://api.weather.gov/gridpoints/${point.wfo}/${point.x},${point.y}/forecast`);
				if (!forecast) {
					if (debugFlag('verbose-failures')) {
						console.warn(`Regional Forecast request for ${city.Name ?? city.city} failed`);
					}
					return false;
				}

				// get XY on map for city
				const cityXY = utils.getXYForCity(city, minMaxLatLon.maxLat, minMaxLatLon.minLon, this.weatherParameters.state, available.x - 60, available.y);

				// wait for the regional observation if it's not done yet
				const observation = await observationPromise;

				if (!observation) return false;

				// format the observation the same as the forecast
				const regionalObservation = {
					daytime: !!/\/day\//.test(observation.icon),
					temperature: temperatureConverter(observation.temperature.value),
					name: utils.formatCity(city.city),
					icon: observation.icon,
					x: cityXY.x,
					y: cityXY.y,
				};

				// preload the icon
				preloadImg(getSmallIcon(regionalObservation.icon, !regionalObservation.daytime));

				// filter out expired periods first, then use the next two periods for forecast
				const activePeriods = filterExpiredPeriods(forecast.properties.periods);

				// ensure we have enough periods for forecast
				if (activePeriods.length < 3) {
					console.warn(`Insufficient active periods for ${city.Name ?? city.city}: only ${activePeriods.length} periods available`);
					return false;
				}

				// group together the current observation and next two periods
				return [
					regionalObservation,
					utils.buildForecast(activePeriods[1], city, cityXY),
					utils.buildForecast(activePeriods[2], city, cityXY),
				];
			} catch (error) {
				console.error(`Unexpected error getting Regional Forecast data for '${city.name ?? city.city}': ${error.message}`);
				return false;
			}
		}));

		// filter out any false (unavailable data)
		const regionalData = regionalDataAll.filter((data) => data);

		// test for data present
		if (regionalData.length === 0) {
			this.setStatus(STATUS.noData);
			return;
		}

		// return the weather data and offsets
		this.data = {
			regionalData,
			mapOffsetXY,
			sourceXY,
		};

		this.setStatus(STATUS.loaded);
	}

	drawCanvas() {
		super.drawCanvas();
		// break up data into useful values
		const { regionalData: data, sourceXY } = this.data;

		// draw the header graphics

		// draw the appropriate title
		const titleTop = this.elem.querySelector('.title.dual .top');
		const titleBottom = this.elem.querySelector('.title.dual .bottom');
		if (this.screenIndex === 0) {
			titleTop.innerHTML = 'Regional';
			titleBottom.innerHTML = 'Observations';
		} else {
			const forecastDate = DateTime.fromISO(data[0][this.screenIndex].time);

			// get the name of the day
			const dayName = forecastDate.toLocaleString({ weekday: 'long' });
			titleTop.innerHTML = 'Forecast for';
			// draw the title
			titleBottom.innerHTML = data[0][this.screenIndex].daytime
				? dayName
				: `${dayName} Night`;
		}

		// draw the map
		const { available, mapOffsetXY } = scaling();
		const scale = available.x / (mapOffsetXY.x * 2);
		const map = this.elem.querySelector('.map');
		map.style.transform = `scale(${scale}) translate(-${sourceXY.x}px, -${sourceXY.y}px)`;

		const cities = data.map((city) => {
			const fill = {};
			const period = city[this.screenIndex];

			fill.icon = { type: 'img', src: getSmallIcon(period.icon, !period.daytime) };
			fill.city = period.name;
			const { temperature } = period;
			fill.temp = temperature;

			const { x, y } = period;

			const elem = this.fillTemplate('location', fill);
			elem.style.left = `${x}px`;
			elem.style.top = `${y}px`;

			return elem;
		});

		const locationContainer = this.elem.querySelector('.location-container');
		locationContainer.innerHTML = '';
		locationContainer.append(...cities);

		this.finishDraw();
	}
}

const getAndFormatPoint = async (lat, lon) => {
	try {
		const point = await getPoint(lat, lon);
		if (!point) {
			return null;
		}
		return {
			x: point.properties.gridX,
			y: point.properties.gridY,
			wfo: point.properties.gridId,
		};
	} catch (error) {
		throw new Error(`Unexpected error getting point for ${lat},${lon}: ${error.message}`);
	}
};

// register display
registerDisplay(new RegionalForecast(6, 'regional-forecast'));
