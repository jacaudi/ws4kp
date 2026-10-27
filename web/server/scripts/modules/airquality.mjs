// Air Quality display — the current US EPA AQI for PM2.5, from the key-free Open-Meteo Air Quality
// API. Laid out like spc-outlook.mjs: the shared header and background, SPC's six-band staircase
// (one band per EPA category) and a bar to the value's band, drawn in HTML (_air-quality.scss).

import STATUS from './status.mjs';
import { safeJson } from './utils/fetch.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	AQI_BANDS, BAND_EDGES, parseAirQuality, aqiBandCenterX, pollutantRows,
} from './airquality-utils.mjs';

// One Open-Meteo request for everything the display shows: PM2.5's AQI (the chart) and each
// pollutant's AQI and concentration (the portrait table).
const buildUrl = (latitude, longitude) => 'https://air-quality-api.open-meteo.com/v1/air-quality'
	+ `?latitude=${latitude}&longitude=${longitude}`
	+ '&current=us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,'
	+ 'pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';

// width of the .chart the bands and reading are positioned in (_air-quality.scss)
const CHART_WIDTH = 640;
// smallest font size (px) a long city name shrinks to; the column's normal size is 32px
const MIN_NAME_SIZE = 20;

class AirQuality extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Air Quality', true);
		// one screen
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (weatherParameters) this.weatherParameters = weatherParameters;
		if (!super.getData(weatherParameters, refresh)) return;

		const { latitude, longitude } = this.weatherParameters;
		const url = buildUrl(latitude, longitude);

		const raw = await safeJson(url, {
			retryCount: 1,
			stillWaiting: () => this.stillWaiting(),
		});

		const parsed = parseAirQuality(raw);

		if (!parsed) {
			// Initial load / location change: the base class already cleared this.data (see
			// weatherdisplay.mjs getData — "refresh doesn't delete existing data, and is reused
			// if the silent refresh fails"), so there is no prior data to fall back on here.
			// Self-disable as before (coverage gap / upstream failure with nothing to show).
			if (!this.data) {
				this.timing.totalScreens = 0;
				this.calcNavTiming();
				this.setStatus(STATUS.noData);
				return;
			}
			// Background refresh with existing good data: a transient upstream failure
			// (safeJson retries only once) should not blank a display that was rendering
			// fine. Keep the last-good data, rotation slot, and status in place — mirrors
			// spc-outlook.mjs, which likewise leaves totalScreens/status untouched on a
			// refresh failure once data has loaded successfully. super.getData() set
			// this.status = STATUS.loading at the top of this call, so restore it to
			// loaded here or the display stays wrongly excluded from rotation.
			this.setStatus(STATUS.loaded);
			return;
		}

		this.data = parsed;
		this.timing.totalScreens = 1;
		this.calcNavTiming();
		this.screenIndex = 0;
		this.setStatus(STATUS.loaded);
	}

	drawCanvas() {
		super.drawCanvas();

		const { aqi, current } = this.data;

		// SPC Outlook's staircase: each band starts 20px right of the one in front of it (its label tab)
		// and one 20px row higher, and ends at its own column's right edge. Widest first, so each
		// narrower band draws over the one behind it. Labels sit as SPC's do, 16px into the tab and
		// 14px above the band's top, so they are positioned beside the bands rather than inside them.
		const geometry = AQI_BANDS.map((band, index) => ({
			band,
			left: BAND_EDGES[0] - 20 + (index * 20),
			right: BAND_EDGES[index + 1],
			top: (AQI_BANDS.length - 1 - index) * 20,
		}));
		const bands = geometry.map(({
			band, left, right, top,
		}) => {
			const elem = document.createElement('div');
			elem.className = `band ${band.cssClass}`;
			elem.style.left = `${left}px`;
			elem.style.width = `${right - left}px`;
			elem.style.top = `${top}px`;
			elem.style.backgroundColor = band.color;
			return elem;
		}).reverse();
		const labels = geometry.map(({ band, left, top }) => {
			const elem = document.createElement('div');
			elem.className = 'band-label';
			elem.textContent = band.category;
			elem.style.left = `${left + 16}px`;
			elem.style.top = `${top - 14}px`;
			return elem;
		});
		this.elem.querySelector('.bands').replaceChildren(...bands, ...labels);

		// the reading, as SPC's day rows: the city ends 10px short of the bar, which starts at the first
		// column's left edge and stops at the centre of the value's column (content width; the 3px
		// border either side lands the tip just past centre, as SPC's bars do). The value sits in the
		// bar's end: every category's bar is long enough for that category's largest number.
		const name = this.elem.querySelector('.reading .name');
		name.textContent = this.weatherParameters.city || '';
		name.style.right = `${CHART_WIDTH - (BAND_EDGES[0] - 10)}px`;
		// a city name wider than the column steps down in size rather than being cut off
		name.style.fontSize = '';
		for (let size = 30; name.scrollWidth > name.clientWidth && size >= MIN_NAME_SIZE; size -= 2) {
			name.style.fontSize = `${size}px`;
		}
		const bar = this.elem.querySelector('.reading .bar');
		bar.querySelector('.value').textContent = aqi.toString();
		bar.style.left = `${BAND_EDGES[0]}px`;
		bar.style.width = `${Math.round(aqiBandCenterX(aqi) - BAND_EDGES[0])}px`;

		// portrait detail table: each pollutant's own AQI and its concentration, in white as SPC's
		// table values are (EPA's maroon and purple would be unreadable on the box's dark blue)
		const table = this.elem.querySelector('.details .table');
		table.querySelectorAll('.row-cell').forEach((cell) => cell.remove());
		const cell = (className, text) => {
			const elem = document.createElement('div');
			elem.className = `row-cell ${className}`;
			elem.textContent = text;
			return elem;
		};
		table.append(...pollutantRows(current).flatMap((row) => [
			cell('label', row.label),
			cell('aqi', row.aqi),
			cell('concentration', row.concentration),
		]));

		this.finishDraw();
	}
}

export default AirQuality;

// register display — navId 12 (append after radar=11); elemId 'air-quality'
registerDisplay(new AirQuality(13, 'air-quality'));
