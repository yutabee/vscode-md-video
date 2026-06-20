import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import { extractAudio, isNoAudioStderr } from '../src/media/audio';
import {
    createCleanup,
    discoverFfmpeg,
    makeTempDir,
    makeVideoOnlyMp4,
    uniqueInput,
    writeExtractFake,
} from '../test-support';

// Acceptance tests for the hardened extraction engine:
//  #3 concurrent extraction must run ffmpeg only once (in-flight dedup)
//  #4 large ffmpeg stderr must not abort extraction (no execFile maxBuffer cap)
//  #6 a killed extraction leaves no usable cache file (only a .part, cleaned up)
//  #9 a video with no audio track is reported distinctly (err.noAudio === true)
//
// #3/#4/#6 use a FAKE ffmpeg (a tiny node script) so they are deterministic and
// need no real ffmpeg. #9 needs real ffmpeg and self-skips when absent.

// The fake is a `#!/usr/bin/env node` shebang spawned as a binary, so the
// fake-driven tests self-skip on Windows (matches test/ffmpegCache.test.ts).
const isWindows = process.platform === 'win32';

// Poll until `pid` is gone (kill(pid, 0) throws), proving the child was reaped
// rather than left as an orphan. Throws if it is still alive after `ms`.
async function assertReaped(pid: number, ms = 2000): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
        try {
            process.kill(pid, 0);
        } catch {
            return; // ESRCH: the child is gone
        }
        if (Date.now() >= deadline) {
            throw new Error(`child pid ${pid} was not reaped within ${ms}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

let workDir = '';
let fakeFfmpeg = '';
const cleanup = createCleanup();

before(() => {
    workDir = cleanup.track(makeTempDir('mdva-fixtest'));
    fakeFfmpeg = writeExtractFake(workDir);
});

after(() => {
    cleanup.run();
});

test('#3 concurrent extractAudio for the same input runs ffmpeg only once', async (t) => {
    if (isWindows) { t.skip('fake ffmpeg relies on a unix shebang'); return; }
    const input = uniqueInput(workDir);
    const cacheDir = cleanup.track(makeTempDir('mdva-fix-dedup'));
    const counter = path.join(workDir, `cnt-${crypto.randomBytes(4).toString('hex')}`);
    process.env.MDVA_FAKE_COUNTER = counter;
    process.env.MDVA_FAKE_STDERR_MB = '0';
    process.env.MDVA_FAKE_DELAY_MS = '200'; // overlap window
    try {
        const results = await Promise.all([
            extractAudio(fakeFfmpeg, input, cacheDir),
            extractAudio(fakeFfmpeg, input, cacheDir),
            extractAudio(fakeFfmpeg, input, cacheDir),
        ]);
        assert.equal(results[0], results[1]);
        assert.equal(results[1], results[2]);
        const calls = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0;
        assert.equal(calls, 1, `ffmpeg should run once, ran ${calls} times`);
    } finally {
        delete process.env.MDVA_FAKE_COUNTER;
        delete process.env.MDVA_FAKE_DELAY_MS;
    }
});

test('#4 large ffmpeg stderr does not abort extraction', async (t) => {
    if (isWindows) { t.skip('fake ffmpeg relies on a unix shebang'); return; }
    const input = uniqueInput(workDir);
    const cacheDir = cleanup.track(makeTempDir('mdva-fix-stderr'));
    const sentFile = path.join(workDir, `sent-${crypto.randomBytes(4).toString('hex')}`);
    process.env.MDVA_FAKE_STDERR_MB = '4'; // >> execFile default maxBuffer (1MB)
    process.env.MDVA_FAKE_DELAY_MS = '0';
    process.env.MDVA_FAKE_STDERR_SENT = sentFile;
    try {
        const out = await extractAudio(fakeFfmpeg, input, cacheDir);
        assert.ok(fs.existsSync(out), 'extraction completed despite large stderr');
        assert.ok(out.endsWith('.mp3'));
        // The fake drains its writes before finishing, so this is what the parent
        // actually consumed: proves the 16KB rolling tail absorbed a load far past
        // execFile's 1MB maxBuffer (the regression that drove us to spawn()).
        const sent = fs.existsSync(sentFile) ? parseInt(fs.readFileSync(sentFile, 'utf8'), 10) : 0;
        assert.ok(sent >= 4 * 1024 * 1024, `fake should have streamed >=4MB of stderr, sent ${sent}`);
    } finally {
        delete process.env.MDVA_FAKE_STDERR_MB;
        delete process.env.MDVA_FAKE_DELAY_MS;
        delete process.env.MDVA_FAKE_STDERR_SENT;
    }
});

test('#6 a never-exiting ffmpeg is killed by the injected timeout and leaves no usable file', async (t) => {
    if (isWindows) { t.skip('fake ffmpeg relies on a unix shebang'); return; }
    const input = uniqueInput(workDir);
    const cacheDir = cleanup.track(makeTempDir('mdva-fix-timeout'));
    const pidFile = path.join(workDir, `pid-${crypto.randomBytes(4).toString('hex')}`);
    process.env.MDVA_FAKE_HANG = '1';
    process.env.MDVA_FAKE_PID_FILE = pidFile;
    try {
        await assert.rejects(
            () => extractAudio(fakeFfmpeg, input, cacheDir, { timeoutMs: 200 }),
            (err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                assert.match(message, /timed out/i, `expected a timeout error, got: ${message}`);
                return true;
            },
        );
        // The hung fake CREATED a .part file before hanging, so this is no longer a
        // vacuous check: the post-kill cleanup must have actually removed it. No
        // canonical .mp3 and no leftover .part may survive for a later open.
        const entries = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
        assert.equal(entries.length, 0, `cache dir must be empty after a killed extraction: ${entries.join(', ')}`);
        // The child must be reaped, not orphaned: the kill path is real, not just
        // a promise rejection that abandons a live process.
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        assert.ok(pid > 0, 'fake recorded its pid');
        await assertReaped(pid);
    } finally {
        delete process.env.MDVA_FAKE_HANG;
        delete process.env.MDVA_FAKE_PID_FILE;
    }
});

test('isNoAudioStderr() recognizes the known no-audio phrasings and nothing else', () => {
    assert.equal(isNoAudioStderr('Output file does not contain any stream'), true);
    assert.equal(isNoAudioStderr('Stream map "0:a" matches no streams.'), true);
    assert.equal(isNoAudioStderr('Output file is empty, nothing was encoded'), true);
    assert.equal(isNoAudioStderr('Some unrelated ffmpeg error: invalid data'), false);
    assert.equal(isNoAudioStderr(''), false);
});

test('#9 a video with no audio track rejects with err.noAudio === true', async (t) => {
    const ffmpeg = await discoverFfmpeg();
    if (!ffmpeg) { t.skip('real ffmpeg not available'); return; }

    const videoOnly = await makeVideoOnlyMp4(ffmpeg, workDir);
    const cacheDir = cleanup.track(makeTempDir('mdva-fix-noaudio'));

    await assert.rejects(
        () => extractAudio(ffmpeg, videoOnly, cacheDir),
        (err: unknown) => {
            const noAudio = (err as { noAudio?: boolean } | null)?.noAudio;
            assert.equal(noAudio, true, `expected err.noAudio===true, got ${noAudio}`);
            return true;
        },
    );
});
