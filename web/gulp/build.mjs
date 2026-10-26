import 'dotenv/config';
import {
	src, dest, series, parallel, watch,
} from 'gulp';
import ejs from 'gulp-ejs';
import rename from 'gulp-rename';
import htmlmin from 'gulp-html-minifier-terser';
import { deleteAsync } from 'del';
import webpack from 'webpack-stream';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';
import log from 'fancy-log';
import OVERRIDES from '../src/overrides.mjs';

// get cloudfront
import reader from '../src/playlist-reader.mjs';

const sass = gulpSass(dartSass);
const run = promisify(execFile);

const clean = () => deleteAsync(['./dist/**/*', '!./dist/readme.txt']);

const RESOURCES_PATH = './dist/resources';

// Data is now served as JSON files to avoid redundancy

// the app's single entry point, server/scripts/ws.mjs imports every module that registers itself when it loads

const wsModules = [
	'./server/scripts/ws.mjs',
];

const webpackOptions = {
	mode: 'production',
	output: {
		filename: '[name].min.js',
	},
	devtool: 'source-map',
	entry: {
		ws: wsModules,
	},
	// the single bundle is over webpack's default 244 KiB limit, so warn when it grows past this instead
	performance: {
		maxAssetSize: 450 * 1024,
		maxEntrypointSize: 450 * 1024,
	},
	module: {
		rules: [{
			// the vendor files are UMD or plain scripts; treated as ES modules, proj4 sets its global the same way it does in the browser
			test: /[\\/]vendor[\\/]auto[\\/](proj4|swiped-events)\.js$/,
			type: 'javascript/esm',
		}],
	},
};
// webpack-stream takes its entry from the config, the files here only start the stream
const buildJs = () => src(wsModules, { read: false })
	.pipe(webpack(webpackOptions))
	.pipe(dest(RESOURCES_PATH));

const cssSources = [
	'server/styles/scss/ws.scss',
];
const buildCss = () => src(cssSources, { sourcemaps: true })
	.pipe(sass({ style: 'compressed' }).on('error', sass.logError))
	.pipe(rename({ suffix: '.min' }))
	.pipe(dest(RESOURCES_PATH, { sourcemaps: '.' }));

const htmlSources = [
	'views/*.ejs',
];

const getVersion = async () => {
	const packageJson = await readFile('package.json');
	const packageVersion = JSON.parse(packageJson).version;

	return process.env.WS4KP_VERSION ?? packageVersion;
};

const compressHtml = async () => {
	const version = await getVersion();
	return src(htmlSources)
		.pipe(ejs({
			production: true,
			serverAvailable: false,
			version,
			OVERRIDES,
			query: {},
		}))
		.pipe(rename({ extname: '.html' }))
		.pipe(htmlmin({ collapseWhitespace: true }))
		.pipe(dest('./dist'));
};

const otherFiles = [
	'server/robots.txt',
	'server/manifest.json',
	'server/music/**/*.mp3',
	'server/apple-touch-icon.png',
	'server/favicon.ico',
	// optional custom scripts the page loads from scripts/, so static hosting and both Docker images include them
	'server/scripts/custom*.*',
];
const copyOtherFiles = () => src(otherFiles, { base: 'server/', encoding: false })
	.pipe(dest('./dist'));

// Copy JSON data files for static hosting
const copyDataFiles = () => src([
	'datagenerators/output/travelcities.json',
	'datagenerators/output/regionalcities.json',
	'datagenerators/output/stations.json',
]).pipe(dest('./dist/data'));

const imageSources = [
	'server/fonts/**',
	'server/images/**',
];

const copyImageSources = () => src(imageSources, { base: './server', encoding: false })
	.pipe(dest('./dist'));

const buildPlaylist = async () => {
	const playlist = await reader();
	// dist doesn't exist yet in a fresh checkout or a Docker build, and the tasks that create it run in parallel with this one
	await mkdir('./dist', { recursive: true });

	await writeFile('./dist/playlist.json', JSON.stringify(playlist));
};

const logVersion = async () => {
	log(`Built version: ${await getVersion()}`);
};

const buildDist = series(clean, parallel(buildJs, buildCss, compressHtml, copyOtherFiles, copyDataFiles, copyImageSources, buildPlaylist), logVersion);

// Dev mode (`task dev`): the Go server serves web/server/ from disk and renders this file as
// the index on each request, injecting the server flag and the runtime OVERRIDES itself.
const DEV_DIR = './.dev';

const buildDevIndex = async () => {
	const version = await getVersion();
	return src('views/index.ejs')
		.pipe(ejs({
			production: false,
			serverAvailable: false,
			version,
			OVERRIDES: {},
			query: {},
		}))
		.pipe(rename({ extname: '.html' }))
		.pipe(dest(DEV_DIR));
};

// exactly `npm run build:css`, so the committed ws.min.css and its map stay byte-identical
// to what that script writes (build-consistency.test.mjs checks the CSS)
const buildDevCss = () => run('npm', ['run', 'build:css']);

// runs until interrupted; `task dev` starts it next to the Go server
const watchDev = () => {
	watch('views/**', buildDevIndex);
	watch('server/styles/scss/**', buildDevCss);
};

export default buildDist;

export {
	logVersion,
	buildDevIndex,
	watchDev,
};
