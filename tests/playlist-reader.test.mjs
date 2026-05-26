import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// playlist-reader uses cwd-relative paths (./server/music, ./server/music/default)
// and reads MUSIC_DIR at call time. Tests run from the repo root and rely on the
// real ./server/music/default directory existing for the fallback test.

const importReader = async () => {
	// fresh import so each test sees the current env state
	const mod = await import(`../src/playlist-reader.mjs?cacheBust=${Math.random()}`);
	return mod.default;
};

test('reads mp3s from MUSIC_DIR when set', async () => {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws4kp-music-'));
	await fs.writeFile(path.join(tmp, 'alpha.mp3'), 'fake');
	await fs.writeFile(path.join(tmp, 'bravo.mp3'), 'fake');
	await fs.writeFile(path.join(tmp, 'notes.txt'), 'ignored');
	const prev = process.env.MUSIC_DIR;
	process.env.MUSIC_DIR = tmp;
	try {
		const reader = await importReader();
		const files = await reader();
		assert.deepStrictEqual(files.sort(), ['alpha.mp3', 'bravo.mp3']);
	} finally {
		if (prev === undefined) delete process.env.MUSIC_DIR;
		else process.env.MUSIC_DIR = prev;
		await fs.rm(tmp, { recursive: true, force: true });
	}
});

test('falls back to bundled defaults when MUSIC_DIR is set but empty of mp3s', async () => {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws4kp-music-'));
	await fs.writeFile(path.join(tmp, 'notes.txt'), 'no mp3s here');
	const prev = process.env.MUSIC_DIR;
	process.env.MUSIC_DIR = tmp;
	try {
		const reader = await importReader();
		const files = await reader();
		// fallback path prefixes each filename with "default/"
		assert.ok(files.length > 0, 'expected fallback to bundled defaults');
		assert.ok(files.every((f) => f.startsWith('default/')), `every entry should be prefixed with default/, got: ${JSON.stringify(files)}`);
		assert.ok(files.every((f) => f.endsWith('.mp3')), 'every entry should end with .mp3');
	} finally {
		if (prev === undefined) delete process.env.MUSIC_DIR;
		else process.env.MUSIC_DIR = prev;
		await fs.rm(tmp, { recursive: true, force: true });
	}
});

test('uses ./server/music when MUSIC_DIR is unset', async () => {
	const prev = process.env.MUSIC_DIR;
	delete process.env.MUSIC_DIR;
	try {
		const reader = await importReader();
		const files = await reader();
		// ./server/music itself has no top-level mp3s, so fallback to default/ kicks in
		assert.ok(files.length > 0, 'expected at least one bundled default mp3');
		assert.ok(files.every((f) => f.endsWith('.mp3')));
	} finally {
		if (prev !== undefined) process.env.MUSIC_DIR = prev;
	}
});
