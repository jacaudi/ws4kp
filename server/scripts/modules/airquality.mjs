// Air Quality display — current US EPA AQI from the key-free Open-Meteo Air Quality API.
// Shaped like spc-outlook.mjs. Renders a full 640x399 canvas reproducing the WS4000 look.

import STATUS from './status.mjs';
import { safeJson } from './utils/fetch.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { parseAirQuality } from './airquality-utils.mjs';

// Open-Meteo request — composite us_aqi plus per-pollutant sub-indices (for dominant) and raw concentrations.
const buildUrl = (latitude, longitude) => 'https://air-quality-api.open-meteo.com/v1/air-quality'
	+ `?latitude=${latitude}&longitude=${longitude}`
	+ '&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,'
	+ 'pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';

class AirQuality extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Air Quality', true);
		// full-canvas display: the canvas draws its own title/gradients, so no HTML header date/time
		this.okToDrawCurrentDateTime = false;
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

		// graceful self-disable when AQ is unavailable for this location (coverage gap / upstream failure)
		if (!parsed) {
			this.timing.totalScreens = 0;
			this.calcNavTiming();
			this.setStatus(STATUS.noData);
			return;
		}

		this.data = parsed;
		this.timing.totalScreens = 1;
		this.calcNavTiming();
		this.screenIndex = 0;
		this.setStatus(STATUS.loaded);
	}

	async drawCanvas() {
		super.drawCanvas();
		// Full canvas rendering is implemented in Task 4.
		this.finishDraw();
	}
}

export default AirQuality;

// NOTE: registration is intentionally NOT here — the registerDisplay import and the
// registerDisplay(new AirQuality(12, 'air-quality')) call are added in Task 6.
