// Air Quality display — current US EPA AQI from the key-free Open-Meteo Air Quality API.
// Shaped like spc-outlook.mjs. Renders a full 640x399 canvas reproducing the WS4000 look.

import STATUS from './status.mjs';
import { safeJson } from './utils/fetch.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { parseAirQuality, aqiBandCenterX } from './airquality-utils.mjs';

// Open-Meteo request — composite us_aqi plus per-pollutant sub-indices (for dominant) and raw concentrations.
const buildUrl = (latitude, longitude) => 'https://air-quality-api.open-meteo.com/v1/air-quality'
	+ `?latitude=${latitude}&longitude=${longitude}`
	+ '&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,'
	+ 'pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';

// ---- local canvas primitives (self-contained; verbatim from the mockup / twc3 draw.js) ----
const horizontalGradient = (context, x1, y1, x2, y2, color1, color2) => {
	const g = context.createLinearGradient(0, y1, 0, y2);
	g.addColorStop(0, color1);
	g.addColorStop(0.4, color2);
	g.addColorStop(0.6, color2);
	g.addColorStop(1, color1);
	context.fillStyle = g;
	context.fillRect(x1, y1, x2 - x1, y2 - y1);
};

const horizontalGradientSingle = (context, x1, y1, x2, y2, color1, color2) => {
	const g = context.createLinearGradient(0, y1, 0, y2);
	g.addColorStop(0, color1);
	g.addColorStop(1, color2);
	context.fillStyle = g;
	context.fillRect(x1, y1, x2 - x1, y2 - y1);
};

const triangle = (context, color, x1, y1, x2, y2, x3, y3) => {
	context.fillStyle = color;
	context.beginPath();
	context.moveTo(x1, y1);
	context.lineTo(x2, y2);
	context.lineTo(x3, y3);
	context.fill();
};

const drawText = (context, font, size, color, x, y, str, shadow = 0, align = 'start') => {
	context.textAlign = align;
	context.font = `${size} '${font}'`;
	context.shadowColor = '#000000';
	context.shadowOffsetX = shadow;
	context.shadowOffsetY = shadow;
	context.strokeStyle = '#000000';
	context.lineWidth = 2;
	context.strokeText(str, x, y);
	context.fillStyle = color;
	context.fillText(str, x, y);
	context.fillStyle = '';
	context.strokeStyle = '';
	context.shadowOffsetX = 0;
	context.shadowOffsetY = 0;
};

const drawBox = (context, color, x, y, width, height) => {
	context.fillStyle = color;
	context.fillRect(x, y, width, height);
};

const titleText = (context, title1, title2) => {
	const font = 'Star4000';
	const size = '24pt';
	const color = '#ffff00';
	const shadow = 3;
	const x = 170;
	let y = 55;
	if (title2) {
		drawText(context, font, size, color, x, y, title1, shadow);
		y += 30;
		drawText(context, font, size, color, x, y, title2, shadow);
	} else {
		y += 15;
		drawText(context, font, size, color, x, y, title1, shadow);
	}
};

// WS4000 title-bar / body gradient stops
const topColor1 = 'rgb(192, 91, 2)';
const topColor2 = 'rgb(72, 34, 64)';
const sideColor1 = 'rgb(46, 18, 80)';
const sideColor2 = 'rgb(192, 91, 2)';

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

		// ensure the WS4000 fonts are ready before drawing canvas text
		await document.fonts.load("24pt 'Star4000'");
		await document.fonts.load("20pt 'Star4000 Small'");

		const canvas = this.elem.querySelector('.aqi-canvas');
		const context = canvas.getContext('2d');
		context.imageSmoothingEnabled = false;
		context.clearRect(0, 0, 640, 399);

		// `current` is retained on this.data for a future concentrations table; not
		// destructured/drawn in the MVP (airbnb's no-void rejects `void current;`).
		const { aqi, category, dominant } = this.data;
		const city = (this.weatherParameters.city || '').toUpperCase();

		// background body (WS4000 blue behind the gradients; only the top strip shows through)
		context.fillStyle = 'rgb(11, 8, 48)';
		context.fillRect(0, 0, 640, 399);

		horizontalGradientSingle(context, 0, 30, 500, 90, topColor1, topColor2);
		triangle(context, 'rgb(28, 10, 87)', 500, 30, 450, 90, 500, 90);
		horizontalGradientSingle(context, 0, 90, 640, 399, sideColor1, sideColor2);

		// Title (line 2 = dominant pollutant for the current-AQI MVP)
		titleText(context, 'Air Quality', dominant ? `Main: ${dominant}` : '');

		// Hazardous — right edge capped at x=604 with a 20px diagonal top-right notch to the background
		context.fillStyle = '#FF0000';
		context.beginPath();
		context.moveTo(320, 90);
		context.lineTo(584, 90);
		context.lineTo(604, 110);
		context.lineTo(604, 399);
		context.lineTo(320, 399);
		context.closePath();
		context.fill();
		triangle(context, '#FF0000', 300, 90, 320, 90, 320, 110);
		drawText(context, 'Star4000 Small', '20pt', '#FFFFFF', 320, 105, 'HAZARDOUS', 1);
		// Very Unhealthy — right edge 533
		drawBox(context, '#FF8000', 320, 110, 213, 289);
		triangle(context, '#FF8000', 300, 110, 320, 110, 320, 130);
		triangle(context, '#FF0000', 513, 110, 533, 110, 533, 130);
		drawText(context, 'Star4000 Small', '20pt', '#FFFFFF', 320, 125, 'VERY UNHEALTHY', 1);
		// Unhealthy — right edge 462
		drawBox(context, '#FFB000', 320, 130, 142, 269);
		triangle(context, '#FFB000', 300, 130, 320, 130, 320, 150);
		triangle(context, '#FF8000', 442, 130, 462, 130, 462, 150);
		drawText(context, 'Star4000 Small', '20pt', '#FFFFFF', 320, 145, 'UNHEALTHY', 1);
		// Good — right edge 391
		drawBox(context, '#FFFF00', 320, 150, 71, 249);
		triangle(context, '#FFFF00', 300, 150, 320, 150, 320, 170);
		triangle(context, '#FFB000', 371, 150, 391, 150, 391, 170);
		drawText(context, 'Star4000 Small', '20pt', '#FFFFFF', 320, 165, 'GOOD', 1);

		// City Name
		drawText(context, 'Star4000', '24pt', '#FFFFFF', 240, 280, city, 2, 'right');
		// AQI value — colored by its health category (health-protective mapping made visible)
		drawText(context, 'Star4000', '24pt', category.color, 310, 280, aqi.toString(), 2, 'right');

		// Indicator — grey "thermometer" bar that GROWS from the GOOD band's left edge (x=320)
		// and STOPS with its tip at the center of the value's category band (quantized length).
		// Drawn last, on top of the staircase.
		const cx = aqiBandCenterX(aqi);
		const barX = 320; // GOOD band's LEFT edge (not 315)
		const barY = 245;
		const barH = 50;
		const barW = Math.round(cx - barX);
		horizontalGradient(context, barX, barY, barX + barW, barY + barH, '#404040', '#B0B0B0');
		drawBox(context, '#000000', barX + barW - 2, barY, 2, barH); // right cap (tip at band center)
		drawBox(context, '#FFFFFF', barX, barY, barW, 2); // top edge
		drawBox(context, '#FFFFFF', barX, barY, 2, barH); // left edge
		drawBox(context, '#000000', barX, barY + barH - 2, barW, 2); // bottom edge

		this.finishDraw();
	}
}

export default AirQuality;

// register display — navId 12 (append after radar=11); elemId 'air-quality'
registerDisplay(new AirQuality(12, 'air-quality'));
