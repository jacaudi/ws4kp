// Regression guards for the two scrolling-display bugs fixed in the 7.1.4-7.1.6 catch-up.
//
// hazards, hourly and travelforecast all render a tall list into a persistent container and scroll
// it by translating the container. Two bugs lived in that arrangement:
//
//   A. FROZEN SCROLL. baseCountChange() caches maxOffset and only re-measures when the container
//      element identity changes or the cached displayHeight is 0. But the container (.hazard-lines
//      etc.) is persistent - only its children are replaced - and displayHeight is a fixed css
//      value. Both conditions therefore stay false forever after the first measurement, so maxOffset
//      keeps the height of whatever content was measured FIRST. Taller content later is clamped
//      partway through and freezes there, never reaching its end. The fix zeroes displayHeight and
//      nulls the cached element after every rebuild.
//
//   B. SCROLL RESTART. These displays refresh on a timer (hazards every 60s) while a long scroll
//      runs for minutes. Every refresh rebuilt the DOM unconditionally, restarting the scroll from
//      the top, so a long list could never reach its end. The fix compares a content signature and
//      skips the rebuild when nothing rendered has changed.
//
// The displays are byte-identical to upstream/main and must stay that way, so nothing is exported
// from them for testing. The harness instead rewrites only their import specifiers and runs the
// real drawLongCanvas()/baseCountChange() against a minimal fake DOM - see helpers/.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import loadDisplay from './helpers/scroll-display-harness.mjs';
import { MAIN_HEIGHT } from './helpers/scroll-display-stubs.mjs';

const alert = (id, event, description) => ({ id, properties: { event, description } });
const hour = (temp) => ({
	temperature: temp, apparentTemperature: temp - 2, windSpeed: 7, windDirection: 'NW', icon: 'sunny.gif',
});
const city = (name, high) => ({
	name, high, low: high - 20, icon: 'clear.gif', today: true,
});

const DISPLAYS = [
	{
		name: 'hazards',
		module: 'hazards.mjs',
		selector: '.hazard-lines',
		cacheKey: 'hazardLines',
		short: () => [alert('a', 'Flood Warning', 'Minor flooding expected. '.repeat(8))],
		tall: () => [
			alert('a', 'Flood Warning', 'Minor flooding expected. '.repeat(8)),
			alert('b', 'Tornado Warning', 'Take shelter now. '.repeat(120)),
		],
	},
	{
		name: 'hourly',
		module: 'hourly.mjs',
		selector: '.hourly-lines',
		cacheKey: 'hourlyLines',
		short: () => Array.from({ length: 4 }, (unused, i) => hour(50 + i)),
		tall: () => Array.from({ length: 24 }, (unused, i) => hour(50 + i)),
	},
	{
		name: 'travelforecast',
		module: 'travelforecast.mjs',
		selector: '.travel-lines',
		cacheKey: 'travelLines',
		short: () => [city('Chicago', 60), city('Detroit', 58), city('Duluth', 44)],
		tall: () => Array.from({ length: 12 }, (unused, i) => city(`City ${i}`, 50 + i)),
	},
];

// px currently scrolled, read back out of the transform baseCountChange() writes
const scrollOffset = (list) => {
	const match = /translateY\(-(\d+)px\)/.exec(list.style.transform ?? '');
	assert.ok(match, `expected a translateY transform, got ${list.style.transform}`);
	return Number(match[1]);
};

// a count far past the end of any scroll, so the offset lands on maxOffset
const SCROLL_TO_END = 100_000;

DISPLAYS.forEach(({
	name, module, selector, cacheKey, short, tall,
}) => describe(name, () => {
	const draw = async (display, data) => {
		display.data = data;
		await display.drawLongCanvas();
	};

	test('a refresh with unchanged content leaves the rendered rows and the scroll position alone', async () => {
		// bug B: without the signature guard every 60s refresh wiped the DOM and sent a
		// minutes-long scroll back to the top, so it could never reach the end
		const display = await loadDisplay(module);
		const list = display.elem.querySelector(selector);

		await draw(display, tall());
		const rendered = [...list.children];
		display.navBaseCount = 400;
		display.baseCountChange(display.navBaseCount);
		const offsetBefore = scrollOffset(list);
		assert.ok(offsetBefore > 0, 'the display should have scrolled before the refresh');

		await draw(display, tall());

		assert.deepEqual(list.children, rendered, 'identical content must not be re-rendered');
		assert.equal(display.navBaseCount, 400, 'an unchanged refresh must not reset the scroll count');
		assert.equal(scrollOffset(list), offsetBefore, 'an unchanged refresh must not move the scroll');
	});

	test('a refresh with changed content rebuilds the rows and restarts the scroll', async () => {
		// the other half of bug B's guard: short-circuiting on every call would freeze the display
		// on stale content forever, so changed content must still rebuild
		const display = await loadDisplay(module);
		const list = display.elem.querySelector(selector);

		await draw(display, short());
		const rendered = [...list.children];
		display.navBaseCount = 400;

		await draw(display, tall());

		assert.notDeepEqual(list.children, rendered, 'changed content must be re-rendered');
		assert.ok(list.children.length > 0, 'changed content must leave rows in the list');
		assert.equal(display.navBaseCount, 0, 'new content must scroll from the top');
	});

	test('a refresh rebuilds when the signature matches but the list is empty', async () => {
		// the `list.children.length > 0` half of the guard: a signature recorded for a list that is
		// no longer populated must not suppress the rebuild, or the display renders nothing at all
		const display = await loadDisplay(module);
		const list = display.elem.querySelector(selector);

		await draw(display, tall());
		assert.ok(list.children.length > 0);
		list.innerHTML = '';

		await draw(display, tall());

		assert.ok(list.children.length > 0, 'an emptied list must be repopulated even when the signature matches');
	});

	test('content that grows taller can scroll all the way to its end', async () => {
		// bug A: maxOffset was measured once and never again, so taller content was clamped at the
		// height of whatever was rendered first and froze partway through
		const display = await loadDisplay(module);
		const list = display.elem.querySelector(selector);

		await draw(display, short());
		display.baseCountChange(SCROLL_TO_END);
		const shortEnd = scrollOffset(list);
		assert.equal(shortEnd, Math.max(0, list.offsetHeight - MAIN_HEIGHT));

		await draw(display, tall());
		const tallHeight = list.offsetHeight;
		assert.ok(tallHeight - MAIN_HEIGHT > shortEnd, 'the tall fixture must actually be taller');

		display.baseCountChange(SCROLL_TO_END);

		assert.equal(
			scrollOffset(list),
			tallHeight - MAIN_HEIGHT,
			'the scroll is clamped to a maxOffset measured from the previous, shorter content',
		);
		assert.equal(display.scrollCache.maxOffset, tallHeight - MAIN_HEIGHT);
	});

	test('rebuilding invalidates the scroll cache so the next base count re-measures', async () => {
		// states the fix directly: element identity never changes and displayHeight is a css
		// constant, so an explicit invalidation is the only thing that can trigger a re-measure
		const display = await loadDisplay(module);

		await draw(display, short());
		display.baseCountChange(1);
		assert.equal(display.scrollCache.displayHeight, MAIN_HEIGHT);
		assert.ok(display.scrollCache[cacheKey], `${cacheKey} should be cached after a measurement`);

		await draw(display, tall());

		assert.equal(display.scrollCache.displayHeight, 0, 'displayHeight must be zeroed to force a re-measure');
		assert.equal(display.scrollCache[cacheKey], null, `${cacheKey} must be nulled to force a re-measure`);
	});
}));
