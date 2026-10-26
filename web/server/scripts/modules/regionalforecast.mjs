// regional forecast and observations
// type 0 = observations, 1 = first forecast, 2 = second forecast

import STATUS from './status.mjs';
import { coerce } from './utils/calc.mjs';
import { safeJson, safePromiseAll } from './utils/fetch.mjs';
import { temperature as temperatureUnit } from './utils/units.mjs';
import preloadImg from './utils/preload-image.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import getPoint from './utils/get-point.mjs';
import { debugFlag } from './utils/debug.mjs';
import filterExpiredPeriods from './utils/forecast-utils.mjs';
import settings from './settings.mjs';
import createProjection, { OUTPUTSIZES } from './utils/map-projection.mjs';
import { getRegionalObservation, formatCity, buildForecast } from './regionalforecast-utils.mjs';
import { RegionalCities, StationInfo } from './utils/data-loader.mjs';
import {
	LABEL_BOX,
	LABEL_PAD,
	STATE_MAPS,
	filterJunkStations,
	isMeasured,
	labelWidth,
	linearProjection,
	placeCandidates,
	regionalSelectionConfig,
	resolveLabelCollisions,
	selectRegionalCities,
} from './regionalforecast-select.mjs';

// array indices for reference
const PX = 0;
const PY = 1;

// CONUS uses upstream's mercator basemap; Alaska and Hawaii keep 7.4.0's maps
const CONUS_MAP = 'forecast-conus';

// the map image, its projection and its displayed size for the user's state
const mapFor = (state) => {
	const stateMap = STATE_MAPS[state];
	if (stateMap) {
		return {
			image: stateMap.image,
			projection: linearProjection(stateMap),
			mapSize: { width: stateMap.width * stateMap.scale, height: stateMap.height * stateMap.scale },
		};
	}
	return {
		image: `images/maps/${CONUS_MAP}.webp`,
		projection: createProjection(CONUS_MAP),
		mapSize: OUTPUTSIZES[CONUS_MAP],
	};
};

// the map panel (.main.has-scroll) for the current display mode, from shared/_positions.scss:
// $standard-scroll-height / $portrait-scroll-height tall, standard or wide width
const drawableArea = () => {
	const area = { width: 640, height: 310 };
	if (settings.enhanced?.value) {
		if (settings.wide?.value) area.width = 854;
		if (settings.portrait?.value) area.height = 967;
	}
	return area;
};

// names a forecast period the same way in every time zone: day or night, and the local date it ends on.
// night periods end the morning after, so "Tonight" and an after-midnight "Overnight" for the same night match
const periodKey = (period) => `${DateTime.fromISO(period.endTime, { setZone: true }).toISODate()} ${period.isDaytime ? 'day' : 'night'}`;

class RegionalForecast extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Regional Forecast', true);

		// timings
		this.timing.totalScreens = 3;

		// set while a change of display mode is choosing and loading a new set of cities, it
		// leaves the map empty instead of showing the previous selection
		this.reloadingForMode = false;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;
		// regional forecast implements a silent reload
		// but it will not fall back to previously loaded data if data can not be loaded
		// there are enough other cities available to populate the map sufficiently even if some do not load

		// this.weatherParameters, not the argument: re-ticking the display's checkbox calls getData() with none
		this.layout = this.calcLayout();
		const { projection, available, offset } = this.layout;

		// pre-load the base map, sized to the projection it was measured against
		const mapImage = this.elem.querySelector('.map img');
		mapImage.src = this.layout.image;
		mapImage.style.width = `${this.layout.mapSize.width}px`;

		// window-scaled cap; spacing is handled in pixels against the label box
		const { count } = regionalSelectionConfig(
			!!(settings.enhanced?.value && settings.wide?.value),
			!!(settings.enhanced?.value && settings.portrait?.value),
		);
		const user = { lat: this.weatherParameters.latitude, lon: this.weatherParameters.longitude };

		// candidate pool: regional cities, then stations; junk stations (priority >= 50) dropped
		//
		// Coerce lat/lon at this boundary. regionalcities.json ships them as STRINGS while
		// stations.json uses numbers, and the two are merged into one pool below. geoDistance
		// takes a midpoint via (lat1 + lat2), so a string operand concatenates instead of adding:
		// selection silently reorders, a nearby place losing its slot to a remoter one.
		const cities = (await RegionalCities).map((c) => ({
			...c, lat: Number(c.lat), lon: Number(c.lon), baked: true, priority: 0,
		}));
		const stations = Object.values(await StationInfo).map((s) => ({
			...s, lat: Number(s.lat), lon: Number(s.lon), baked: false,
		}));
		// Project every candidate and keep only those whose whole label fits on screen. An
		// off-map place is replaced by the next nearest rather than drawn on the edge, and the
		// fetch loop below never spends requests on a city that could not be drawn.
		const candidates = placeCandidates(
			filterJunkStations([...cities, ...stations]).map((c) => ({ ...c, labelWidth: labelWidth(formatCity(c.city)) })),
			projection,
			offset,
			available,
		);

		// rank nearest-to-user (stations de-emphasised), space by label box, cap at count
		const selected = selectRegionalCities(user, candidates, { count });

		// get a unit converter
		const temperatureConverter = temperatureUnit();

		// get regional forecasts and observations using centralized safe Promise handling
		const regionalDataAll = await safePromiseAll(selected.map(async (city) => {
			try {
				const point = city?.point ?? (await getAndFormatPoint(city.lat, city.lon));
				if (!point) {
					if (debugFlag('verbose-failures')) {
						console.warn(`Unable to get Points for '${city.city}'`);
					}
					return false;
				}

				// start off the observation task
				const observationPromise = getRegionalObservation(city);

				const forecast = await safeJson(`https://api.weather.gov/gridpoints/${point.wfo}/${point.x},${point.y}/forecast`, { retryCount: 1, timeout: 5000 });
				if (!forecast) {
					if (debugFlag('verbose-failures')) {
						console.warn(`Regional Forecast request for ${city.city} failed`);
					}
					return false;
				}

				// wait for the regional observation if it's not done yet
				const observation = await observationPromise;

				if (!observation) return false;

				// format the observation the same as the forecast
				const regionalObservation = {
					temperature: temperatureConverter(observation.temperature.value),
					name: formatCity(city.city),
					icon: observation.ws4icon,
					x: city.pxy[PX],
					y: city.pxy[PY],
				};

				// preload the icon
				preloadImg(regionalObservation.icon);

				// filter out expired periods first, then use the next two periods for forecast
				const activePeriods = filterExpiredPeriods(forecast.properties.periods);

				// ensure we have enough periods for forecast
				if (activePeriods.length < 3) {
					console.warn(`Insufficient active periods for ${city.city}: only ${activePeriods.length} periods available`);
					return false;
				}

				// determine the necessary forecast periods to find

				// the forecast periods to show are picked once all the stations have loaded
				return { regionalObservation, activePeriods, city };
			} catch (error) {
				console.error(`Unexpected error getting Regional Forecast data for '${city.city}': ${error.message}`);
				return false;
			}
		}));

		// filter out any false (unavailable data)
		const loaded = regionalDataAll.filter((data) => data);

		// the first station that loaded picks the two forecast periods, the same station sets the title.
		// every other station shows its matching periods, which can sit at a different index when it's
		// in another time zone and has already rolled over from day to night
		const targets = loaded.length > 0 ? [periodKey(loaded[0].activePeriods[1]), periodKey(loaded[0].activePeriods[2])] : [];
		const regionalData = loaded.map(({ regionalObservation, activePeriods, city }) => {
			const periods = targets.map((key) => activePeriods.find((period) => periodKey(period) === key));
			if (periods.some((period) => !period)) {
				if (debugFlag('verbose-failures')) {
					console.warn(`Regional Forecast for ${city.city} has no period matching ${targets.join(', ')}`);
				}
				return false;
			}
			return [regionalObservation, ...periods.map((period) => buildForecast(period, city))];
		}).filter((data) => data);

		// test for data present
		if (regionalData.length === 0) {
			this.setStatus(STATUS.noData);
			return;
		}

		// return the weather data
		// the offsets used to draw it come from this.layout, which is recalculated whenever the
		// display mode changes
		this.data = {
			regionalData,
		};

		this.setStatus(STATUS.loaded);
	}

	// arithmetic only: one projection build, a coerce and a subtraction.
	// called from getData() and from modeChanged(), never from drawCanvas()
	calcLayout() {
		const available = drawableArea();
		const { image, projection, mapSize } = mapFor(this.weatherParameters.state);
		const user = projection.forward([this.weatherParameters.longitude, this.weatherParameters.latitude]);
		user[PX] = coerce(user[PX], available.width / 2, mapSize.width - (available.width / 2));
		user[PY] = coerce(user[PY], available.height / 2, mapSize.height - (available.height / 2));
		return {
			available,
			projection,
			image,
			mapSize,
			user,
			offset: [user[PX] - (available.width / 2), user[PY] - (available.height / 2)],
		};
	}

	// the cities shown are chosen to fit the available space, so a change of display mode has to
	// pick them again. the map re-centres immediately and is left empty while the new selection
	// is chosen and loaded
	async modeChanged() {
		if (this.status !== STATUS.loaded) return;

		const previous = this.layout;
		this.layout = this.calcLayout();

		// widescreen only adds space when enhanced is also on, so a switch between standard and
		// widescreen leaves the available area, and the cities that fit in it, unchanged
		if (previous
			&& previous.available.width === this.layout.available.width
			&& previous.available.height === this.layout.available.height) return;

		// the cities that fit the new area have not been chosen yet, so empty the map rather than
		// leave the previous selection sitting in places that no longer match it. the map itself
		// re-centres right away, which is arithmetic only
		this.reloadingForMode = true;
		if (this.active) this.drawCanvas();

		// choose and load the cities for the new area through the normal data path
		try {
			await this.getData(this.weatherParameters, true);
		} finally {
			this.reloadingForMode = false;
		}
		if (this.active) this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		// break up data into useful values
		const { regionalData: data } = this.data;

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

		// calculate the overall offset (top/left corner)
		const { offset } = this.layout;

		// draw the map
		const map = this.elem.querySelector('.map');
		map.style.transform = `translate(-${offset[PX]}px, -${offset[PY]}px)`;

		// a change of display mode leaves the map empty until the new selection has loaded
		const cities = this.reloadingForMode ? [] : data.map((city, rank) => {
			const fill = {};
			const period = city[this.screenIndex];

			fill.icon = { type: 'img', src: period.icon };
			fill.city = period.name;
			const { temperature } = period;
			fill.temp = temperature;

			const { x, y } = period;

			const elem = this.fillTemplate('location', fill);
			// the label box selection reserved: LABEL_BOX offsets from the city's point
			elem.style.left = `${x - offset[PX] + LABEL_BOX.offsetX}px`;
			elem.style.top = `${y - offset[PY] + LABEL_BOX.offsetY}px`;
			// selection order (nearest first, stations yielding to cities) decides who keeps a contested spot
			elem.dataset.rank = rank;

			return elem;
		});

		const locationContainer = this.elem.querySelector('.location-container');
		locationContainer.innerHTML = '';
		locationContainer.append(...cities);

		// drop labels whose real rendered box overlaps a better-ranked label or the logo
		this.declutterLabels(locationContainer, cities);

		this.finishDraw();
	}

	// The corner logo hangs 7px into the map panel; anything else that covers the map would go
	// here. Measured from the DOM, so the wide and portrait layouts need no second set of numbers.
	// Scoped to the display's own header: each label carries a .header of its own.
	chromeObstacles(container) {
		const containerRect = container.getBoundingClientRect();
		return Array.from(this.elem.querySelectorAll(':scope > .header .logo'))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.height > 0)
			.map((r) => ({
				left: r.left - containerRect.left,
				top: r.top - containerRect.top,
				right: r.right - containerRect.left,
				bottom: r.bottom - containerRect.top,
			}));
	}

	// eslint-disable-next-line class-methods-use-this -- pure DOM-measurement helper, no instance state needed
	measureLabels(container, elems) {
		const containerRect = container.getBoundingClientRect();
		return elems.map((el) => {
			let left = Infinity;
			let top = Infinity;
			let right = -Infinity;
			let bottom = -Infinity;
			el.querySelectorAll('.city, .temp, .icon img').forEach((child) => {
				const r = child.getBoundingClientRect();
				if (!r.width) return;
				left = Math.min(left, r.left);
				top = Math.min(top, r.top);
				right = Math.max(right, r.right);
				bottom = Math.max(bottom, r.bottom);
			});
			return {
				el,
				dist: Number(el.dataset.rank),
				rect: {
					left: left - containerRect.left,
					top: top - containerRect.top,
					right: right - containerRect.left,
					bottom: bottom - containerRect.top,
				},
			};
		});
	}

	// Decluttering is a MEASUREMENT, so it cannot run in the same tick as the append that
	// created these elements: the children have no layout yet, every box comes back degenerate,
	// and resolveLabelCollisions would keep everything. Wait for a frame, and if the boxes still
	// are not real (a hidden display is laid out lazily), retry for a few frames rather than
	// decluttering against garbage.
	//
	// The icons size the labels too (max-height only, so width follows the image), and an icon
	// that has not loaded measures 0px wide: its label would be judged narrower than it draws and
	// kept, then overlap a neighbour once the image arrives. So wait for the icons first.
	async declutterLabels(container, elems, attempt = 0) {
		const MAX_ATTEMPTS = 10;
		if (attempt === 0) {
			const icons = elems.flatMap((el) => Array.from(el.querySelectorAll('.icon img')));
			// a broken icon draws nothing, so it cannot cause an overlap; measure without it
			await Promise.all(icons.map((img) => img.decode().catch(() => {})));
		}
		requestAnimationFrame(() => {
			// elements may have been replaced by a newer draw while we waited
			if (!elems.length || !elems[0].isConnected) return;

			const items = this.measureLabels(container, elems);
			if (!items.every((i) => isMeasured(i.rect))) {
				if (attempt < MAX_ATTEMPTS) this.declutterLabels(container, elems, attempt + 1);
				return;
			}

			const containerRect = container.getBoundingClientRect();
			const mainRect = this.elem.querySelector('.main').getBoundingClientRect();
			const bounds = {
				left: mainRect.left - containerRect.left,
				top: mainRect.top - containerRect.top,
				right: mainRect.right - containerRect.left,
				bottom: mainRect.bottom - containerRect.top,
			};

			const kept = new Set(resolveLabelCollisions(items, LABEL_PAD, this.chromeObstacles(container), bounds).map((i) => i.el));
			elems.filter((el) => !kept.has(el)).forEach((el) => el.remove());
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
		throw new Error(`Unexpected error getting point for ${lat}, ${lon}: ${error.message} `);
	}
};

// register display
registerDisplay(new RegionalForecast(6, 'regional-forecast'));
