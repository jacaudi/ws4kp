// Integration gate: load each location against a running ws4kp server (server
// mode, so the /api and /airquality proxies are exercised against live NOAA/
// Open-Meteo) and fail the build if any location is broken.
//
// A location FAILS if, while it loads:
//   - the /api or /airquality proxy returns a 5xx (the class of the Envoy 502
//     framing bug), or
//   - the page throws an uncaught error, or
//   - the forecast never resolves (the grid point in the footer stays empty).
//
// Console errors are logged but NOT failed on: the app benignly 404s optional
// resources (e.g. the custom.js hook probe), which are not forecast failures.
//
// Each location gets a few attempts to absorb transient api.weather.gov blips
// (the NWS API is not fully operational and can fail by region); a location is
// only reported failed after every attempt fails. Exit non-zero on any failure.

import puppeteer from 'puppeteer';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

const BASE_URL = process.env.WS4KP_TEST_URL || 'http://localhost:8080';
const SETTLE_MS = 20_000; // max time to wait for a location to resolve
const POLL_MS = 500;
const MAX_ATTEMPTS = 3; // per-location retries for transient NWS failures
const RETRY_BACKOFF_MS = 3_000;

const LOCATIONS = JSON.parse(await readFile(new URL('./locations.json', import.meta.url), 'utf8'));

const browser = await puppeteer.launch({
	headless: true,
	args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

// Load one location on a fresh page; return an array of problem strings (empty = pass).
const checkLocation = async (location) => {
	const page = await browser.newPage();
	const problems = [];

	const onConsole = (msg) => {
		// Diagnostic only — do not fail (benign optional-resource 404s log here too).
		if (msg.type() === 'error') console.log(`  [console.error] ${location}: ${msg.text()}`);
	};
	const onPageError = (err) => problems.push(`pageerror: ${err.message}`);
	const onResponse = (res) => {
		const url = res.url();
		if ((url.includes('/api/') || url.includes('/airquality/')) && res.status() >= 500) {
			problems.push(`HTTP ${res.status()} ${url}`);
		}
	};
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	page.on('response', onResponse);

	try {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#txtLocation');
		await page.click('#txtLocation', { clickCount: 3 });
		await page.type('#txtLocation', location);
		await delay(600); // let autocomplete settle before submitting
		await page.click('#btnGetLatLng');

		// The footer grid point populates once /points + /gridpoints resolve — our "loaded" signal.
		let resolved = false;
		const deadline = Date.now() + SETTLE_MS;
		while (Date.now() < deadline && problems.length === 0) {
			// eslint-disable-next-line no-await-in-loop
			const grid = await page.$eval('#spanGridPoint', (el) => el.textContent.trim()).catch(() => '');
			if (grid) { resolved = true; break; }
			// eslint-disable-next-line no-await-in-loop
			await delay(POLL_MS);
		}
		if (!resolved && problems.length === 0) {
			problems.push('forecast did not load (grid point never populated) within timeout');
		}
	} catch (err) {
		problems.push(`exception: ${err.message}`);
	} finally {
		page.off('console', onConsole);
		page.off('pageerror', onPageError);
		page.off('response', onResponse);
		await page.close();
	}

	return problems;
};

let failed = 0;
for (let i = 0; i < LOCATIONS.length; i += 1) {
	const location = LOCATIONS[i];
	let problems = [];
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop
		problems = await checkLocation(location);
		if (problems.length === 0) {
			console.log(`PASS  ${location}`);
			break;
		}
		console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed for ${location}: ${problems.join('; ')}`);
		if (attempt < MAX_ATTEMPTS) {
			// eslint-disable-next-line no-await-in-loop
			await delay(RETRY_BACKOFF_MS);
		}
	}
	if (problems.length > 0) {
		console.error(`FAIL  ${location}: ${problems.join('; ')}`);
		failed += 1;
	}
}

await browser.close();

if (failed > 0) {
	console.error(`\n${failed}/${LOCATIONS.length} location(s) failed the integration check`);
	process.exit(1);
}
console.log(`\nAll ${LOCATIONS.length} locations loaded cleanly`);
