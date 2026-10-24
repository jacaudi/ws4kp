// Builds the Air Quality backgrounds from SPC Outlook's (6.png, 6-portrait.png): the same header
// band and bottom bar, with SPC's colored bands removed. Each painted row is filled with that
// row's own pixel from the left edge, which is plain body gradient in both images. Portrait keeps
// SPC's detail box (rows 633-1055), which Air Quality fills with its pollutant table, just as SPC
// fills it with its probabilistic outlook.
//
// One image rather than a CSS gradient layered over 6.png: layered, the browser's smoothing at
// any non-1x scale bleeds 6.png's band edges into the rows around them and leaves a visible seam.
//
// Images are served with a one-year immutable cache (index.mjs staticOptions), so a browser that
// has fetched one never asks again. If a regenerated image's content changes once it has shipped,
// give it a new file name (and update _air-quality.scss), or those browsers keep the old one.
//
// Run: node image-templates/air-quality-backgrounds.mjs
// Handles only what these sources are: 8-bit RGBA, non-interlaced PNG.
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
// a dev-only script: crc32 needs Node 20.15+/22.2+, newer than the server's engines floor of 20
// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { crc32, deflate, inflate } from 'node:zlib';

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

const DIR = new URL('../server/images/backgrounds/', import.meta.url);
// [source, output, first row to paint, last row to paint]: the body below the header band, down
// to the bottom bar (standard) or to just above the detail box (portrait)
const IMAGES = [
	['6.png', 'air-quality.png', 90, 398],
	['6-portrait.png', 'air-quality-portrait.png', 90, 632],
];
const EDGE_X = 5;
const BYTES_PER_PIXEL = 4;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const chunks = (png) => {
	const found = [];
	for (let offset = SIGNATURE.length; offset < png.length;) {
		const length = png.readUInt32BE(offset);
		found.push({ type: png.toString('ascii', offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + length) });
		offset += 12 + length;
	}
	return found;
};

const paeth = (a, b, c) => {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
};

// undo the per-row filters (PNG spec section 9) and return { width, height, pixels }
const decode = async (png) => {
	const all = chunks(png);
	const header = all.find((c) => c.type === 'IHDR').data;
	const width = header.readUInt32BE(0);
	const height = header.readUInt32BE(4);
	if (header[8] !== 8 || header[9] !== 6 || header[12] !== 0) throw new Error('expected 8-bit RGBA, non-interlaced');
	const raw = await inflateAsync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)));
	const stride = width * BYTES_PER_PIXEL;
	const pixels = Buffer.alloc(stride * height);
	Array.from({ length: height }).forEach((_, y) => {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = y * stride;
		Array.from({ length: stride }).forEach((__, x) => {
			const left = x >= BYTES_PER_PIXEL ? pixels[row + x - BYTES_PER_PIXEL] : 0;
			const up = y > 0 ? pixels[row - stride + x] : 0;
			const upLeft = y > 0 && x >= BYTES_PER_PIXEL ? pixels[row - stride + x - BYTES_PER_PIXEL] : 0;
			const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upLeft)][filter];
			pixels[row + x] = (line[x] + predictor) % 256;
		});
	});
	return { width, height, pixels };
};

const chunk = (type, data) => {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
};

const encode = async ({ width, height, pixels }) => {
	const stride = width * BYTES_PER_PIXEL;
	// filter type 0 on every row
	const raw = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), pixels.subarray(y * stride, (y + 1) * stride)])));
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', await deflateAsync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

await Promise.all(IMAGES.map(async ([source, output, top, bottom]) => {
	const image = await decode(await readFile(new URL(source, DIR)));
	const stride = image.width * BYTES_PER_PIXEL;
	// every body row becomes one flat color: its left-edge pixel
	for (let y = top; y <= bottom; y += 1) {
		const edge = image.pixels.subarray(y * stride + EDGE_X * BYTES_PER_PIXEL, y * stride + (EDGE_X + 1) * BYTES_PER_PIXEL);
		for (let x = 0; x < image.width; x += 1) image.pixels.set(edge, y * stride + x * BYTES_PER_PIXEL);
	}
	await writeFile(new URL(output, DIR), await encode(image));
	console.log(`${source} -> ${output}`);
}));
