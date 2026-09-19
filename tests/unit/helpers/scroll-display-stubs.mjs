// Stubs and a minimal DOM used to run the real drawLongCanvas()/baseCountChange() of the three
// scrolling displays (hazards, hourly, travelforecast) inside node --test.
//
// Those three files are byte-identical to upstream and must stay that way, so nothing here may be
// imported by them. Instead scroll-display-harness.mjs rewrites their import specifiers to point at
// this module, which means the code under test is the unmodified source on disk - including the
// module-private contentSignature() helper.

import { Settings } from '../../../server/scripts/vendor/auto/luxon.mjs';

// freeze luxon's clock: hourly.mjs folds the current hour into its content signature, so a real
// clock would make "identical content" flaky across an hour rollover
Settings.now = () => Date.parse('2026-01-15T12:34:56.000Z');

// height of the fixed-size viewport the list scrolls inside (.main), in px - a constant in css,
// which is precisely why the scroll cache never invalidates on it
const MAIN_HEIGHT = 250;

// rows are as tall as their text is long, so more or wordier content really does measure taller
const textHeight = (fillValues) => {
	const text = Object.values(fillValues ?? {})
		.map((v) => (typeof v === 'string' ? v : ''))
		.join('');
	return 30 + Math.ceil(text.length / 40) * 20;
};

class FakeElement {
	constructor(name, ownHeight = 0) {
		this.name = name;
		this.children = [];
		this.style = {};
		this.classList = { add: () => {}, remove: () => {}, contains: () => false };
		this.ownHeight = ownHeight;
		this.selectors = new Map();
		this.html = '';
	}

	register(selector, element) {
		this.selectors.set(selector, element);
		return element;
	}

	querySelector(selector) {
		return this.selectors.get(selector) ?? null;
	}

	append(...nodes) {
		this.children.push(...nodes);
	}

	set innerHTML(value) {
		this.html = value;
		if (value === '') this.children = [];
	}

	get innerHTML() {
		return this.html;
	}

	// the browser measures the union of the children; an empty list collapses to its own height
	get offsetHeight() {
		if (this.children.length === 0) return this.ownHeight;
		return this.children.reduce((total, child) => total + child.offsetHeight, 0);
	}

	get scrollHeight() {
		return this.offsetHeight;
	}
}

// stand-in for WeatherDisplay. Only the members the three drawLongCanvas()/baseCountChange() paths
// touch are implemented; anything else is deliberately absent so an untested path fails loudly.
class WeatherDisplay {
	constructor(navId, elemId) {
		this.navId = navId;
		this.elemId = elemId;
		this.navBaseCount = 0;
		this.timing = { totalScreens: 1, baseDelay: 100, delay: 1 };
		this.scrollTiming = { initialCounts: 0, pixelsPerCount: 0 };
		this.status = null;

		this.elem = new FakeElement('display');
		this.main = this.elem.register('.main', new FakeElement('main', MAIN_HEIGHT));
		this.list = new FakeElement('lines');
		// every display queries only its own selector; wiring all three keeps one base class usable
		['.hazard-lines', '.hourly-lines', '.travel-lines'].forEach((s) => this.elem.register(s, this.list));
	}

	fillTemplate(templateName, fillValues) {
		const row = new FakeElement(templateName, textHeight(fillValues));
		row.register('.like', new FakeElement('like'));
		return row;
	}

	setStatus(status) {
		this.status = status;
	}

	calcNavTiming() {}
}

// displays register themselves at module scope; that call is how the harness gets the instance
const registered = [];
const registerDisplay = (display) => registered.push(display);
const takeRegistered = () => registered.pop();

const timeZone = () => 'UTC';

// network and browser-only edges: never reached by the draw paths under test
const notReached = (name) => () => { throw new Error(`${name} must not be called in these tests`); };
const safeJson = notReached('safeJson');
const safePromiseAll = notReached('safePromiseAll');
const getSmallIcon = notReached('getSmallIcon');
const getHourlyIcon = notReached('getHourlyIcon');
const getSun = notReached('getSun');
const temperature = notReached('temperature');
const windSpeed = notReached('windSpeed');
const directionToNSEW = notReached('directionToNSEW');
const debugFlag = () => false;
const settings = {};

export {
	MAIN_HEIGHT,
	FakeElement,
	WeatherDisplay,
	registerDisplay,
	takeRegistered,
	timeZone,
	safeJson,
	safePromiseAll,
	getSmallIcon,
	getHourlyIcon,
	getSun,
	temperature,
	windSpeed,
	directionToNSEW,
	debugFlag,
	settings,
};
