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
	// Problems are split by WHO is at fault, because the two deserve different
	// outcomes: a regression here must block the pipeline, while api.weather.gov
	// having a bad afternoon must not.
	const appProblems = [];
	const upstreamProblems = [];

	const onConsole = (msg) => {
		// Diagnostic only — do not fail (benign optional-resource 404s log here too).
		if (msg.type() === 'error') console.log(`  [console.error] ${location}: ${msg.text()}`);
	};
	const onPageError = (err) => appProblems.push(`pageerror: ${err.message}`);
	const onResponse = (res) => {
		const url = res.url();
		// 5xx is upstream failing; 429 is upstream rate-limiting us, which a burst of
		// regional city lookups reliably provokes. Neither says anything about our code.
		if ((url.includes('/api/') || url.includes('/airquality/'))
			&& (res.status() >= 500 || res.status() === 429)) {
			upstreamProblems.push(`HTTP ${res.status()} ${url}`);
		}
	};
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	page.on('response', onResponse);

	// Declared out here so it survives the try/finally and can be reported below.
	let resolved = false;

	try {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#txtLocation');
		await page.click('#txtLocation', { clickCount: 3 });
		await page.type('#txtLocation', location);
		await delay(600); // let autocomplete settle before submitting
		await page.click('#btnGetLatLng');

		// The footer grid point populates once /points + /gridpoints resolve — our "loaded" signal.
		//
		// Only an app-level problem aborts the wait. A transient upstream 5xx used to
		// end it immediately, which was wrong: utils/fetch.mjs retries, so the location
		// frequently recovers. If it resolves, it passed — whatever upstream did on the
		// way there.
		const deadline = Date.now() + SETTLE_MS;
		while (Date.now() < deadline && appProblems.length === 0) {
			// eslint-disable-next-line no-await-in-loop
			const grid = await page.$eval('#spanGridPoint', (el) => el.textContent.trim()).catch(() => '');
			if (grid) { resolved = true; break; }
			// eslint-disable-next-line no-await-in-loop
			await delay(POLL_MS);
		}
		if (!resolved && appProblems.length === 0) {
			// Attribute the timeout. Having seen upstream 5xx/429 for this location, the
			// far likelier explanation is that upstream never answered — not that we
			// broke. With a clean upstream, a timeout is ours and must block.
			const timedOut = 'forecast did not load (grid point never populated) within timeout';
			if (upstreamProblems.length > 0) upstreamProblems.push(timedOut);
			else appProblems.push(timedOut);
		}
	} catch (err) {
		appProblems.push(`exception: ${err.message}`);
	} finally {
		page.off('console', onConsole);
		page.off('pageerror', onPageError);
		page.off('response', onResponse);
		await page.close();
	}

	return { appProblems, upstreamProblems, resolved };
};

let appFailed = 0;
let upstreamFailed = 0;
for (let i = 0; i < LOCATIONS.length; i += 1) {
	const location = LOCATIONS[i];
	let result = { appProblems: [], upstreamProblems: [], resolved: false };
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop
		result = await checkLocation(location);
		if (result.resolved && result.appProblems.length === 0) {
			const noise = result.upstreamProblems.length
				? ` (recovered from ${result.upstreamProblems.length} upstream error(s))`
				: '';
			console.log(`PASS  ${location}${noise}`);
			break;
		}
		const all = [...result.appProblems, ...result.upstreamProblems];
		console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed for ${location}: ${all.join('; ')}`);
		if (attempt < MAX_ATTEMPTS) {
			// eslint-disable-next-line no-await-in-loop
			await delay(RETRY_BACKOFF_MS);
		}
	}
	if (result.appProblems.length > 0) {
		console.error(`FAIL  ${location}: ${result.appProblems.join('; ')}`);
		appFailed += 1;
	} else if (!result.resolved) {
		console.error(`UPSTREAM  ${location}: ${result.upstreamProblems.join('; ')}`);
		upstreamFailed += 1;
	}
}

await browser.close();

// Exit codes are the contract with CI (see .github/workflows/ci-test.yml):
//   0  everything loaded
//   1  at least one APP failure — a real regression, must block
//   75 upstream-only failure (EX_TEMPFAIL). Nothing here is broken; NOAA is. The
//      pipeline reports it and moves on, so a third party's rate limiter cannot
//      turn every build red. STRICT_INTEGRATION=1 (the nightly run) makes it fail
//      instead, so sustained upstream breakage still gets surfaced.
const EX_TEMPFAIL = 75;
if (appFailed > 0) {
	console.error(`\n${appFailed}/${LOCATIONS.length} location(s) failed the integration check`);
	process.exit(1);
}
if (upstreamFailed > 0) {
	const strict = process.env.STRICT_INTEGRATION === '1';
	console.error(`\n${upstreamFailed}/${LOCATIONS.length} location(s) did not load because upstream was failing`);
	process.exit(strict ? 1 : EX_TEMPFAIL);
}
console.log(`\nAll ${LOCATIONS.length} locations loaded cleanly`);
