import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	mkdtemp, mkdir, writeFile, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	toFork, toUpstream, differingFiles, forkOnlyFiles,
} from './path-map.mjs';

const run = promisify(execFile);

const MAP = [
	{ from: 'server/', to: 'web/server/' },
	{ from: 'index.mjs', to: 'web/index.mjs' },
	{ from: 'server/special.txt', to: 'never/used.txt' }, // shadowed by the prefix above: first match wins
];

test('a prefix entry rewrites the prefix and keeps the rest of the path', () => {
	assert.equal(toFork(MAP, 'server/scripts/ws.mjs'), 'web/server/scripts/ws.mjs');
});

test('an exact entry only matches the whole path', () => {
	assert.equal(toFork(MAP, 'index.mjs'), 'web/index.mjs');
	assert.equal(toFork(MAP, 'index.mjs.bak'), 'index.mjs.bak');
});

test('an unmatched path maps to itself', () => {
	assert.equal(toFork(MAP, 'README.md'), 'README.md');
	assert.equal(toUpstream(MAP, 'docs/usage.md'), 'docs/usage.md');
});

test('entries are tried in order and the first match wins', () => {
	assert.equal(toFork(MAP, 'server/special.txt'), 'web/server/special.txt');
});

test('toUpstream inverts toFork', () => {
	assert.equal(toUpstream(MAP, 'web/server/scripts/ws.mjs'), 'server/scripts/ws.mjs');
	assert.equal(toUpstream(MAP, 'web/index.mjs'), 'index.mjs');
});

test('differingFiles and forkOnlyFiles compare content through the map, not by path', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'path-map-'));
	const git = async (...args) => (await run('git', args, { cwd: dir })).stdout;
	try {
		await git('init', '-q');
		await git('config', 'user.email', 't@example.com');
		await git('config', 'user.name', 't');
		await git('config', 'commit.gpgsign', 'false');
		await mkdir(path.join(dir, 'server'));
		await writeFile(path.join(dir, 'server', 'same.mjs'), 'same\n');
		await writeFile(path.join(dir, 'server', 'changed.mjs'), 'before\n');
		await writeFile(path.join(dir, 'server', 'gone.mjs'), 'gone\n');
		await writeFile(path.join(dir, 'index.mjs'), 'entry\n');
		await git('add', '-A');
		await git('commit', '-q', '-m', 'upstream layout');
		const upstream = (await git('rev-parse', 'HEAD')).trim();

		await mkdir(path.join(dir, 'web'));
		await git('mv', 'server', 'web/server');
		await git('mv', 'index.mjs', 'web/index.mjs');
		await writeFile(path.join(dir, 'web', 'server', 'changed.mjs'), 'after\n');
		await writeFile(path.join(dir, 'web', 'server', 'added.mjs'), 'fork only\n');
		await git('rm', '-q', '-f', 'web/server/gone.mjs');
		await mkdir(path.join(dir, 'server'), { recursive: true });
		await writeFile(path.join(dir, 'server', 'same.mjs'), 'left behind\n');
		await git('add', '-A');
		await git('commit', '-q', '-m', 'fork layout');

		assert.deepEqual(await differingFiles(upstream, MAP, { cwd: dir }), ['server/changed.mjs', 'server/gone.mjs']);
		// with no map, every moved file differs: proves the map is what makes same.mjs equal
		assert.deepEqual(await differingFiles(upstream, [], { cwd: dir }), ['index.mjs', 'server/changed.mjs', 'server/gone.mjs', 'server/same.mjs']);
		assert.deepEqual(await forkOnlyFiles(upstream, MAP, { cwd: dir }), ['server/added.mjs', 'server/same.mjs']);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
