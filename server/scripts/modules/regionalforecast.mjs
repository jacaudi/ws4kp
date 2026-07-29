// regional forecast and observations
// type 0 = observations, 1 = first forecast, 2 = second forecast

import STATUS from './status.mjs';
import { geoDistance } from './utils/calc.mjs';
import {
	LABEL_PAD,
	filterJunkStations,
	inVisibleWindow,
	getXYForCity,
	isMeasured,
	selectRegionalCities,
	regionalSelectionConfig,
	resolveLabelCollisions,
} from './regionalforecast-select.mjs';
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

	if (settings.enhanced?.value) {
		if (settings.wide?.value) {
			mapOffsetXY.x = 320;
			available.x = 854;
		}

		if (settings.portrait?.value) {
			mapOffsetXY.y = 400;
			available.y = 970;
		}
	}
	return {
		mapOffsetXY,
		available,
	};
};

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
		const { available, mapOffsetXY } = scaling();
		const scale = available.x / (mapOffsetXY.x * 2);
		const sourceXY = utils.getXYFromLatitudeLongitude(this.weatherParameters.latitude, this.weatherParameters.longitude, mapOffsetXY.x, mapOffsetXY.y, weatherParameters.state);

		// get latitude and longitude limits
		const minMaxLatLon = utils.getMinMaxLatitudeLongitude(sourceXY.x, sourceXY.y, mapOffsetXY.x, mapOffsetXY.y, this.weatherParameters.state);

		// window-scaled cap; spacing is handled in pixels against the real label box
		const { count } = regionalSelectionConfig(
			!!(settings.enhanced?.value && settings.wide?.value),
			!!(settings.enhanced?.value && settings.portrait?.value),
		);
		const user = { lat: this.weatherParameters.latitude, lon: this.weatherParameters.longitude };

		// candidate pool: baked regional cities first, then stations; drop junk (priority >= 50)
		//
		// Coerce lat/lon at this boundary. regionalcities.json ships them as STRINGS
		// while stations.json uses numbers, and the two are merged into one pool below.
		// geoDistance takes a midpoint via (lat1 + lat2), so a string operand
		// concatenates instead of adding and the cosine derived from that midpoint is
		// garbage. Selection ranks on that distance, so uncoerced coordinates silently
		// reorder the map — a nearby place losing its slot to a remoter one — with
		// nothing thrown and no NaN to notice.
		const cities = RegionalCities.map((c) => ({
			...c, lat: Number(c.lat), lon: Number(c.lon), baked: true, priority: 0,
		}));
		const stations = Object.values(StationInfo).map((s) => ({
			...s, lat: Number(s.lat), lon: Number(s.lon), baked: false,
		}));
		// Project each candidate BEFORE selecting, and drop the ones that land off the
		// drawable area. inVisibleWindow is a coarse lat/lon prefilter; the pixel test
		// is the authoritative one, because the window scale can push an in-window city
		// past maxX/maxY. Doing this first means an off-map city is replaced by the next
		// nearest candidate instead of just vanishing from the count, and — since the
		// fetch loop below runs over the selected list — we no longer spend a forecast
		// and an observation request on a city that could never be drawn.
		const candidates = filterJunkStations([...cities, ...stations])
			.filter((c) => inVisibleWindow(c, minMaxLatLon))
			.map((c) => ({
				...c,
				xy: getXYForCity(c, minMaxLatLon.maxLat, minMaxLatLon.minLon, this.weatherParameters.state, scale, available.x - 60, available.y),
			}))
			.filter((c) => c.xy);

		// rank nearest-to-user (stations de-emphasised), space by label box, cap at count
		const regionalCities = selectRegionalCities(user, candidates, { count });

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

				// projected during candidate selection above, so it is known drawable here
				const cityXY = { ...city.xy, dist: geoDistance(user.lon, user.lat, city.lon, city.lat) };

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
					dist: cityXY.dist,
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
			elem.dataset.dist = period.dist;

			return elem;
		});

		const locationContainer = this.elem.querySelector('.location-container');
		locationContainer.innerHTML = '';
		locationContainer.append(...cities);

		// drop labels whose real rendered box overlaps a nearer kept label
		this.declutterLabels(locationContainer, cities);

		this.finishDraw();
	}

	// Anything painted over the map that a label must not sit on top of. Measured
	// from the DOM rather than hard-coded, so enhanced/wide/portrait layouts — which
	// move the header and resize the map — are handled without a second set of
	// constants to keep in sync.
	chromeObstacles(container) {
		const containerRect = container.getBoundingClientRect();
		const toLocal = (r) => ({
			left: r.left - containerRect.left,
			top: r.top - containerRect.top,
			right: r.right - containerRect.left,
			bottom: r.bottom - containerRect.top,
		});
		const selectors = ['.header', '.logo', '.title', '.date-time', '.scroll', '.hazard-lines'];
		return selectors
			.flatMap((sel) => Array.from(this.elem.querySelectorAll(sel)))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.height > 0)
			.map(toLocal);
	}

	// eslint-disable-next-line class-methods-use-this -- pure DOM-measurement helper, no instance state needed
	measureLabels(container, elems) {
		const containerRect = container.getBoundingClientRect();
		return elems.map((el) => {
			let left = Infinity;
			let top = Infinity;
			let right = -Infinity;
			let bottom = -Infinity;
			Array.from(el.children).forEach((child) => {
				const r = child.getBoundingClientRect();
				if (!r.width) return;
				left = Math.min(left, r.left);
				top = Math.min(top, r.top);
				right = Math.max(right, r.right);
				bottom = Math.max(bottom, r.bottom);
			});
			return {
				el,
				dist: Number(el.dataset.dist),
				rect: {
					left: left - containerRect.left,
					top: top - containerRect.top,
					right: right - containerRect.left,
					bottom: bottom - containerRect.top,
				},
			};
		});
	}

	// Decluttering is a MEASUREMENT, so it cannot run in the same tick as the append
	// that created these elements — at that point the children have no layout, every
	// box comes back degenerate, and resolveLabelCollisions quietly keeps everything.
	// That is what let overlapping labels ship. Wait for a frame, and if the boxes
	// still are not real (the display can be laid out lazily when hidden), try again
	// for a few frames rather than decluttering against garbage.
	declutterLabels(container, elems, attempt = 0) {
		const MAX_ATTEMPTS = 10;
		requestAnimationFrame(() => {
			// elements may have been replaced by a newer draw while we waited
			if (!elems.length || !elems[0].isConnected) return;

			const items = this.measureLabels(container, elems);
			if (!items.every((i) => isMeasured(i.rect))) {
				if (attempt < MAX_ATTEMPTS) this.declutterLabels(container, elems, attempt + 1);
				return;
			}

			const main = this.elem.querySelector('.main');
			const containerRect = container.getBoundingClientRect();
			const bounds = main
				? {
					left: main.getBoundingClientRect().left - containerRect.left,
					top: main.getBoundingClientRect().top - containerRect.top,
					right: main.getBoundingClientRect().right - containerRect.left,
					bottom: main.getBoundingClientRect().bottom - containerRect.top,
				}
				: undefined;

			const kept = new Set(
				resolveLabelCollisions(items, LABEL_PAD, this.chromeObstacles(container), bounds).map((i) => i.el),
			);
			elems.forEach((el) => { if (!kept.has(el)) el.remove(); });
		});
	}
}

const getAndFormatPoint = async (lat, lon) => {
	try {
		const point = await getPoint(lat, lon);
		if (!point) {
			return null;
		}
		const { gridX, gridY, gridId } = point.properties ?? {};
		// api.weather.gov returns 200 with gridId/gridX/gridY all null for offshore
		// marine stations (forecastOffice NH2), which have no land grid. Returning the
		// object anyway is truthy, so the caller's `if (!point)` check passes and the
		// request becomes gridpoints/null/null,null/forecast, which 404s. Treat a
		// missing grid the same as a missing point so the city is skipped.
		if (gridX === null || gridX === undefined
			|| gridY === null || gridY === undefined
			|| gridId === null || gridId === undefined) {
			return null;
		}
		return {
			x: gridX,
			y: gridY,
			wfo: gridId,
		};
	} catch (error) {
		throw new Error(`Unexpected error getting point for ${lat},${lon}: ${error.message}`);
	}
};

// register display
registerDisplay(new RegionalForecast(6, 'regional-forecast'));
