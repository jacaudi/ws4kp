// Pure, browser-free custom-logo helpers — importable by settings.mjs AND by node --test.
// No window/document/localStorage references may be added to this file; keep it pure.

// localStorage key holding the user's uploaded logo as a PNG data URL.
export const CUSTOM_LOGO_STORAGE_KEY = 'CustomLogoPng';

// Cap on the uploaded PNG. Base64 inflates it by ~4/3, so 1 MB of file becomes roughly
// 1.4 million characters — a real share of a typical 5 MB origin quota, not a formality.
// customLogoFileError states this limit in words; keep the two in step.
export const MAX_CUSTOM_LOGO_BYTES = 1024 * 1024;

// Whether a value read back out of localStorage can be handed to an <img src>.
// This is data-integrity hygiene, NOT a security boundary: writing this origin's
// localStorage already requires script execution here, and a data:image/png URL in an
// <img> cannot execute anything. It exists so a corrupt or hand-edited value falls back
// to the default logo instead of rendering as a broken image.
export const isCustomLogoDataUrl = (value) => typeof value === 'string' && value.startsWith('data:image/png');

// Returns a user-facing message describing why the file is unusable, or null if it's fine.
export const customLogoFileError = (file) => {
	if (file.type !== 'image/png') return 'Only PNG files are supported.';
	if (file.size > MAX_CUSTOM_LOGO_BYTES) return 'PNG must be 1 MB or smaller.';
	return null;
};

// The custom logo shows only when the setting is on AND a logo is stored; either alone
// falls back to the default SVG. `storedLogo` is an already-validated data URL (see
// isCustomLogoDataUrl) or null — validity is settled when it is read, not re-derived here.
export const customLogoEnabled = (settingValue, storedLogo) => Boolean(settingValue) && Boolean(storedLogo);
