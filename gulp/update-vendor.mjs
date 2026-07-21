import { src, series, dest } from 'gulp';
import { deleteAsync } from 'del';
import rename from 'gulp-rename';

const clean = () => deleteAsync(['./server/scripts/vendor/auto/**']);

const vendorFiles = [
	'./node_modules/luxon/build/es6/luxon.mjs',
	'./node_modules/luxon/build/es6/luxon.mjs.map',
	'./node_modules/@zakj/no-sleep/dist/no-sleep.js',
	// suncalc v2 dropped suncalc.js; .cjs is its UMD build, the one a <script> tag needs
	'./node_modules/suncalc/suncalc.cjs',
	'./node_modules/swiped-events/src/swiped-events.js',
];

// Special handling for metar-taf-parser - only copy main file and English locale
const metarFiles = [
	'./node_modules/metar-taf-parser/metar-taf-parser.js',
	'./node_modules/metar-taf-parser/locale/en.js',
];

const copy = () => src(vendorFiles)
	.pipe(rename((path) => {
		path.dirname = path.dirname.toLowerCase();
		path.basename = path.basename.toLowerCase();
		path.extname = path.extname.toLowerCase();
		// keep suncalc at .js; a .cjs extension is served with a non-JavaScript MIME type
		if (path.basename === 'suncalc') path.extname = '.js';
	}))
	.pipe(dest('./server/scripts/vendor/auto'));

const copyMetar = () => src(metarFiles, { base: './node_modules/metar-taf-parser' })
	.pipe(rename((path) => {
		path.basename = path.basename.toLowerCase();
		path.extname = path.extname.toLowerCase();
		if (path.basename === 'metar-taf-parser') path.extname = '.mjs';
	}))
	.pipe(dest('./server/scripts/vendor/auto'));

const updateVendor = series(clean, copy, copyMetar);

export default updateVendor;
