import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import cache from '../../proxy/cache.mjs';

// The singleton starts a periodic cleanup setInterval; clear it so the test
// process can exit instead of hanging on the open timer handle.
after(() => cache.destroy());

// setFilteredHeaders is a static method on the HttpCache class; the module only
// exports the singleton, so reach the class through its constructor.
const { setFilteredHeaders } = cache.constructor;

// Minimal stand-in for an Express `res` that records header() calls (lowercased).
const makeRes = () => {
	const headers = {};
	return {
		headers,
		header(key, value) { headers[key.toLowerCase()] = value; },
	};
};

test('setFilteredHeaders strips hop-by-hop headers so a re-buffered (Content-Length) response is not double-framed', () => {
	// Upstream (e.g. NWS /stations, Open-Meteo /air-quality) replies chunked.
	// The proxy re-buffers and sends with its own Content-Length via res.send(),
	// so forwarding transfer-encoding produces an illegally-framed response that
	// a strict fronting proxy (Envoy) rejects with 502. It must be stripped.
	const res = makeRes();
	setFilteredHeaders(res, {
		'content-type': 'application/json',
		'transfer-encoding': 'chunked',
		connection: 'keep-alive',
		'keep-alive': 'timeout=5',
		te: 'trailers',
		trailer: 'Expires',
		upgrade: 'h2c',
		'proxy-authenticate': 'Basic',
		'proxy-authorization': 'Basic abc',
	});

	for (const h of ['transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization']) {
		assert.equal(res.headers[h], undefined, `hop-by-hop header "${h}" must not be forwarded`);
	}
});

test('setFilteredHeaders passes through ordinary entity headers', () => {
	const res = makeRes();
	setFilteredHeaders(res, { 'content-type': 'application/geo+json', vary: 'Accept' });
	assert.equal(res.headers['content-type'], 'application/geo+json');
	assert.equal(res.headers.vary, 'Accept');
});

test('setFilteredHeaders still strips cache-control headers and sets our own cache policy', () => {
	const res = makeRes();
	setFilteredHeaders(res, {
		'cache-control': 'max-age=3600', expires: 'x', etag: '"abc"', 'last-modified': 'y',
	});
	assert.equal(res.headers.expires, undefined);
	assert.equal(res.headers.etag, undefined);
	assert.equal(res.headers['last-modified'], undefined);
	// our proxy imposes a short client-facing cache policy
	assert.equal(res.headers['cache-control'], 'public, max-age=30');
});
