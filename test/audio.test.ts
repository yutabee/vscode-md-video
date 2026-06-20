import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { extractAudio } from '../src/media/audio';
import {
    createCleanup,
    discoverFfmpeg,
    looksLikeMp3,
    makeAacMp4,
    makeTempDir,
} from '../test-support';

// Exercises the real ffmpeg extraction path. Requires ffmpeg on the machine;
// when it is absent every test self-skips, since the audio feature itself is a
// no-op without ffmpeg.

let ffmpeg: string | null = null;
let workDir = '';
let cacheDir = '';
let sample = '';
const cleanup = createCleanup();

before(async () => {
    ffmpeg = await discoverFfmpeg();
    if (!ffmpeg) { return; }
    workDir = cleanup.track(makeTempDir('mdva-audiotest'));
    cacheDir = cleanup.track(makeTempDir('mdva-audiocache'));
    sample = await makeAacMp4(ffmpeg, workDir);
});

after(() => {
    cleanup.run();
});

test('findFfmpeg locates a working binary (or returns null)', () => {
    assert.ok(ffmpeg === null || typeof ffmpeg === 'string');
});

test('REGRESSION: extractAudio produces a valid, non-empty MP3', async (t) => {
    if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
    const out = await extractAudio(ffmpeg, sample, cacheDir);
    assert.ok(fs.existsSync(out), 'output file exists');
    assert.ok(out.endsWith('.mp3'), 'final output is named .mp3');
    assert.ok(fs.statSync(out).size > 0, 'output is non-empty');
    assert.ok(looksLikeMp3(out), 'output has an MP3 signature (ID3 or frame sync)');
    // No leftover .part files for THIS extraction: the partial temp file
    // (`mdva-audio-<key>.<rand>.part.mp3`) must have been renamed into place.
    const stem = path.basename(out, '.mp3'); // mdva-audio-<key>
    const leftovers = fs.readdirSync(cacheDir)
        .filter((n) => n.startsWith(`${stem}.`) && n.includes('.part'));
    assert.equal(leftovers.length, 0, `no .part leftovers for ${stem}: ${leftovers.join(', ')}`);
});

test('extractAudio is cached: second call returns the same path', async (t) => {
    if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
    const first = await extractAudio(ffmpeg, sample, cacheDir);
    const mtimeBefore = fs.statSync(first).mtimeMs;
    const second = await extractAudio(ffmpeg, sample, cacheDir);
    assert.equal(second, first, 'same cache key -> same path');
    assert.equal(fs.statSync(second).mtimeMs, mtimeBefore, 'cached file not rewritten');
});
