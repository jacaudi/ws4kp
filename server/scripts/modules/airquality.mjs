// Air Quality display — current US EPA AQI from the key-free Open-Meteo Air Quality API.
// Laid out like spc-outlook.mjs: the shared header and background, with the WS4000 staircase
// of category bands and a bar to the value's band drawn in HTML (_air-quality.scss).

import STATUS from './status.mjs';
import { safeJson } from './utils/fetch.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	AQI_BANDS, BAND_EDGES, parseAirQuality, aqiBandCenterX, pollutantRows,
} from './airquality-utils.mjs';

// Open-Meteo request — composite us_aqi plus per-pollutant sub-indices (for dominant) and raw concentrations.
const buildUrl = (latitude, longitude) => 'https://air-quality-api.open-meteo.com/v1/air-quality'
	+ `?latitude=${latitude}&longitude=${longitude}`
	+ '&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,'
	+ 'pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';

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

		const {
			aqi, category, dominant, current,
		} = this.data;

		// second title line: the pollutant driving the index
		this.elem.querySelector('.title.dual .bottom').textContent = dominant ? `Main: ${dominant}` : '';

		// the staircase: each band runs from the GOOD band's left edge (less its 20px label tab) to its
		// own right edge, one 20px label row higher than the band inside it. Widest first, so each
		// narrower band draws over the one behind it.
		const left = BAND_EDGES[0] - 20;
		const bands = AQI_BANDS.map((band, index) => {
			const elem = document.createElement('div');
			elem.className = `band ${band.cssClass}`;
			elem.textContent = band.category;
			elem.style.left = `${left}px`;
			elem.style.width = `${BAND_EDGES[index + 1] - left}px`;
			elem.style.top = `${(AQI_BANDS.length - 1 - index) * 20}px`;
			elem.style.backgroundColor = band.color;
			return elem;
		}).reverse();
		this.elem.querySelector('.bands').replaceChildren(...bands);

		// the reading: city, the value in its category's color, and a bar that stops at the centre of that band
		this.elem.querySelector('.reading .city').textContent = (this.weatherParameters.city || '').toUpperCase();
		const value = this.elem.querySelector('.reading .value');
		value.textContent = aqi.toString();
		value.style.color = category.color;
		this.elem.querySelector('.reading .bar').style.width = `${Math.round(aqiBandCenterX(aqi) - BAND_EDGES[0])}px`;

		// portrait detail table: each pollutant's own AQI, in its category's color, and its concentration
		const table = this.elem.querySelector('.details .table');
		table.querySelectorAll('.row-cell').forEach((cell) => cell.remove());
		const cell = (className, text, color) => {
			const elem = document.createElement('div');
			elem.className = `row-cell ${className}`;
			elem.textContent = text;
			if (color) elem.style.color = color;
			return elem;
		};
		table.append(...pollutantRows(current).flatMap((row) => [
			cell('label', row.label),
			cell('aqi', row.aqi, row.color),
			cell('concentration', row.concentration),
		]));

		this.finishDraw();
	}
}

export default AirQuality;

// register display — navId 12 (append after radar=11); elemId 'air-quality'
registerDisplay(new AirQuality(13, 'air-quality'));
