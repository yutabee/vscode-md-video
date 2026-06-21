import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlayback } from '../src/media/playbackDecision';

// M4 acceptance contract for the pure render-time state machine. The built-in
// preview is one-way, so a render must (a) reflect the cache/extraction state as
// a player status and (b) decide whether to kick a fresh extraction WITHOUT ever
// re-kicking a target that is already in flight or has a terminal outcome.

test('cache hit -> ready, never kicks (even if a stale state lingers)', () => {
  assert.deepEqual(decidePlayback(true, undefined), { status: 'ready', kick: false });
  assert.deepEqual(decidePlayback(true, 'extracting'), { status: 'ready', kick: false });
  assert.deepEqual(decidePlayback(true, 'error'), { status: 'ready', kick: false });
});

test('first sight (no cache, no state) -> preparing AND kicks exactly once', () => {
  assert.deepEqual(decidePlayback(false, undefined), { status: 'preparing', kick: true });
});

test('already extracting -> preparing without a second kick', () => {
  assert.deepEqual(decidePlayback(false, 'extracting'), { status: 'preparing', kick: false });
});

test('terminal-negative outcomes surface without re-kicking', () => {
  assert.deepEqual(decidePlayback(false, 'no-audio'), { status: 'no-audio', kick: false });
  assert.deepEqual(decidePlayback(false, 'ffmpeg-not-found'), { status: 'ffmpeg-not-found', kick: false });
  assert.deepEqual(decidePlayback(false, 'error'), { status: 'error', kick: false });
});
