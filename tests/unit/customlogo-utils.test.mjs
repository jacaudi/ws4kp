import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CUSTOM_LOGO_STORAGE_KEY,
	MAX_CUSTOM_LOGO_BYTES,
	isCustomLogoDataUrl,
	customLogoFileError,
	customLogoEnabled,
} from '../../server/scripts/modules/customlogo-utils.mjs';

// The upload path only ever produces a PNG data URL, but localStorage is
// user-writable, so anything read back out has to be re-validated before it
// reaches an <img src>.

test('the storage key matches the one persisted by earlier versions', () => {
	assert.equal(CUSTOM_LOGO_STORAGE_KEY, 'CustomLogoPng');
});

test('the size limit matches the limit its message states', () => {
	// customLogoFileError promises "1 MB or smaller" in words; if the constant moves
	// without the message, the message becomes a lie and the boundary tests below —
	// which derive their input from the constant — would not notice.
	assert.equal(MAX_CUSTOM_LOGO_BYTES, 1024 * 1024);
});

test('isCustomLogoDataUrl accepts a PNG data URL', () => {
	assert.equal(isCustomLogoDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
});

test('isCustomLogoDataUrl rejects a non-PNG data URL', () => {
	assert.equal(isCustomLogoDataUrl('data:image/jpeg;base64,/9j/4AAQ'), false);
});

test('isCustomLogoDataUrl rejects a remote URL', () => {
	assert.equal(isCustomLogoDataUrl('https://example.com/logo.png'), false);
});

test('isCustomLogoDataUrl rejects empty and missing values', () => {
	assert.equal(isCustomLogoDataUrl(''), false);
	assert.equal(isCustomLogoDataUrl(null), false);
	assert.equal(isCustomLogoDataUrl(undefined), false);
});

test('customLogoFileError accepts a PNG within the size limit', () => {
	assert.equal(customLogoFileError({ type: 'image/png', size: 2048 }), null);
});

test('customLogoFileError accepts a PNG exactly at the size limit', () => {
	assert.equal(customLogoFileError({ type: 'image/png', size: MAX_CUSTOM_LOGO_BYTES }), null);
});

test('customLogoFileError rejects one byte over the size limit', () => {
	assert.equal(
		customLogoFileError({ type: 'image/png', size: MAX_CUSTOM_LOGO_BYTES + 1 }),
		'PNG must be 1 MB or smaller.',
	);
});

test('customLogoFileError rejects a non-PNG file', () => {
	assert.equal(
		customLogoFileError({ type: 'image/jpeg', size: 2048 }),
		'Only PNG files are supported.',
	);
});

test('customLogoFileError reports the wrong type before the size', () => {
	// A huge JPEG is wrong for both reasons; the type message is the useful one.
	assert.equal(
		customLogoFileError({ type: 'image/jpeg', size: MAX_CUSTOM_LOGO_BYTES * 10 }),
		'Only PNG files are supported.',
	);
});

test('customLogoEnabled requires both the setting and a stored logo', () => {
	assert.equal(customLogoEnabled(true, 'data:image/png;base64,iVBORw0KGgo='), true);
});

test('customLogoEnabled is false when the setting is on but nothing is stored', () => {
	assert.equal(customLogoEnabled(true, null), false);
});

test('customLogoEnabled is false when a logo is stored but the setting is off', () => {
	assert.equal(customLogoEnabled(false, 'data:image/png;base64,iVBORw0KGgo='), false);
});

test('customLogoEnabled takes an already-validated stored logo at face value', () => {
	// Validation belongs to isCustomLogoDataUrl, applied once when the value is read
	// out of localStorage. customLogoEnabled only combines "setting on" with "logo
	// present", so it must not re-derive validity from the string it is handed.
	assert.equal(customLogoEnabled(true, 'anything-non-empty'), true);
});

test('customLogoEnabled tolerates an undefined setting value', () => {
	// settings.customLogoImage may not exist yet during early initialization.
	assert.equal(customLogoEnabled(undefined, 'data:image/png;base64,iVBORw0KGgo='), false);
});
