import path from 'node:path';

import { includeIgnoreFile } from '@eslint/config-helpers';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import globals from 'globals';

const gitignorePath = path.resolve('.', '.gitignore');

const jsConfig = defineConfig([
	// ESLint recommended config
	{
		name: 'js/config',
		...js.configs.recommended,
	},
	// Stylistic plugin
	plugins.stylistic,
	// Import X plugin
	plugins.importX,
	// Airbnb base recommended config
	...configs.base.recommended,
]);

const nodeConfig = defineConfig([
	// Node plugin
	plugins.node,
	// Airbnb Node recommended config
	...configs.node.recommended,
]).map((config) => ({
	...config,
	ignores: [...(config.ignores ?? []), 'server/**'],
}));

const rules = {
	'@stylistic/indent': ['error', 'tab', { SwitchCase: 1 }],
	'@stylistic/no-tabs': 0,
	'no-param-reassign': [
		'error',
		{
			props: false,
		},
	],
	'@stylistic/max-len': 0,
	'import-x/extensions': [
		'error',
		'ignorePackages',
		{
			js: 'always',
			mjs: 'always',
			json: 'always',
		},
	],
	'no-console': 'off',
	'no-use-before-define': [
		'error',
		{
			variables: false,
		},
	],
};

const languageOptions = {
	ecmaVersion: 'latest',
	parserOptions: {
		ecmaVersion: 'latest',
	},
};

const ignores = [
	'*.min.*',
	'server/scripts/vendor/*',
	'dist/**/*',
];

const htmlSpecial = {
	files: ['server/**/*.{js,mjs,cjs}'],
	languageOptions: {
		globals: {
			...globals.browser,
			OVERRIDES: 'readonly',
			proj4: 'readonly',
		},
	},
};

// files that rely on devDependencies
const extraneousDependencies = {
	files: [
		'gulp/**/*',
		'gulpfile.mjs',
		'eslint.config.mjs',
		'datagenerators/**/*',
		// build-time helpers gulp imports; the Go server replaced their runtime use
		'src/**/*',
	],
	rules: {
		'import-x/no-extraneous-dependencies': 'off',
	},
};

// web/tests/ is its own npm package (Puppeteer and chalk, kept out of the image's npm ci), so its
// imports resolve outside web/package.json by design, and only once `npm ci --prefix tests` has
// run, which task ci does not do: its two packages are exempt from no-unresolved so the result does
// not depend on what is installed. Its package.json declares no engines, which leaves
// eslint-plugin-n assuming Node 16; the tests run on the Node in .node-version, and use node:test's
// describe and Map.groupBy (Node 22). Reading fixtures synchronously is fine in a test.
const testsConfig = {
	files: ['tests/**/*.{js,mjs,cjs}'],
	settings: {
		n: { version: '>=22' },
	},
	rules: {
		'import-x/no-relative-packages': 'off',
		'import-x/no-extraneous-dependencies': 'off',
		'import-x/no-unresolved': ['error', { commonjs: true, caseSensitive: true, ignore: ['^puppeteer$', '^chalk$'] }],
		'n/no-sync': 'off',
	},
};

// The upstream-review scripts live at the repo root (.claude/skills/upstream-review/), outside
// this directory and with no package.json, so eslint-plugin-n would assume Node 16 for them too.
// The root taskfile lints them with this config from the repo root (task tooling:lint), where
// this pattern matches; from web/ it matches nothing.
const upstreamReviewConfig = {
	files: ['.claude/skills/upstream-review/*.mjs'],
	settings: {
		n: { version: '>=20' },
	},
};

export default defineConfig([
	{
		ignores,
	},
	// Ignore files and folders listed in .gitignore
	includeIgnoreFile(gitignorePath),
	// un-exclude the custom files if used
	{ ignores: ['!server/scripts/custom*.*'] },
	// JavaScript config
	...jsConfig,
	// Node config
	...nodeConfig,
	{
		languageOptions,
		rules,
	},
	htmlSpecial,
	extraneousDependencies,
	testsConfig,
	upstreamReviewConfig,
]);
