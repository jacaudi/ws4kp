// Pure, browser-free custom-logo helpers — importable by settings.mjs AND by node --test.
// No window/document/localStorage references may be added to this file; keep it pure.

// localStorage key holding the user's uploaded logo as a PNG data URL.
export const CUSTOM_LOGO_STORAGE_KEY = 'CustomLogoPng';

// localStorage quotas are ~5 MB and the data URL is base64 (~33% overhead), so cap
// the source PNG well below that. The message below states this limit in words.
export const MAX_CUSTOM_LOGO_BYTES = 1024 * 1024;

// localStorage is user-writable, so anything read back out is untrusted and must be
// re-validated before it reaches an <img src>.
export const isCustomLogoDataUrl = (value) => typeof value === 'string' && value.startsWith('data:image/png');

// Returns a user-facing message describing why the file is unusable, or null if it's fine.
export const customLogoFileError = (file) => {
	if (file.type !== 'image/png') return 'Only PNG files are supported.';
	if (file.size > MAX_CUSTOM_LOGO_BYTES) return 'PNG must be 1 MB or smaller.';
	return null;
};

// The custom logo shows only when the setting is on AND a usable PNG is stored;
// either alone falls back to the default SVG.
export const customLogoEnabled = (settingValue, storedLogo) => Boolean(settingValue) && isCustomLogoDataUrl(storedLogo);
