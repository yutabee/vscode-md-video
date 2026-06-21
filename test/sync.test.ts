import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  driftAction,
  DEFAULT_DRIFT_TUNING,
  canResumeAudio,
  shouldCorrectDrift,
  isBenignPlayError,
  AUDIO_READY_THRESHOLD,
} from '../src/webview/sync';

// M3 acceptance contract for the pure audio/video drift-correction policy.
//
// The previous policy (M0 spike) hard-set audio.currentTime to the video clock
// on every `timeupdate` once drift passed 250 ms. Assigning currentTime is a
// seek: it flushes the decode buffer and re-fetches, so a steady offset (mp3
// encoder delay) turned every frame into a re-seek -> audible dropouts and a
// buffering feedback loop. driftAction replaces that: nudge audio.playbackRate
// for small drift, hard-seek only when drift is too large to rate-correct.
// Pure + DOM-free, so the policy is exercised directly in Node.

const T = DEFAULT_DRIFT_TUNING; // soft 0.1, hard 1.0, rateNudge 0.05

test('within the soft band -> no correction (run at base rate)', () => {
  assert.deepEqual(driftAction(10.0, 10.0, 1, T), { kind: 'none' });
  assert.deepEqual(driftAction(10.05, 10.0, 1, T), { kind: 'none' });
  assert.deepEqual(driftAction(10.0, 10.1, 1, T), { kind: 'none' }); // -soft exactly (behind)
  assert.deepEqual(driftAction(10.1, 10.0, 1, T), { kind: 'none' }); // +soft exactly (ahead)
});

test('audio ahead by a moderate amount -> slow it down via playbackRate', () => {
  const a = driftAction(10.4, 10.0, 1, T); // +0.4s, between soft and hard
  assert.equal(a.kind, 'rate');
  assert.ok(a.kind === 'rate' && a.playbackRate < 1, 'audio ahead should slow below base rate');
  assert.ok(a.kind === 'rate' && Math.abs(a.playbackRate - 0.95) < 1e-9);
});

test('audio behind by a moderate amount -> speed it up via playbackRate', () => {
  const a = driftAction(10.0, 10.4, 1, T); // -0.4s
  assert.equal(a.kind, 'rate');
  assert.ok(a.kind === 'rate' && a.playbackRate > 1, 'audio behind should speed above base rate');
  assert.ok(a.kind === 'rate' && Math.abs(a.playbackRate - 1.05) < 1e-9);
});

test('nudge is relative to the user base rate, not always around 1', () => {
  const ahead = driftAction(10.4, 10.0, 1.5, T);
  assert.equal(ahead.kind, 'rate');
  assert.ok(ahead.kind === 'rate' && Math.abs(ahead.playbackRate - 1.45) < 1e-9);
  const behind = driftAction(10.0, 10.4, 1.5, T);
  assert.ok(behind.kind === 'rate' && Math.abs(behind.playbackRate - 1.55) < 1e-9);
});

test('drift beyond the hard threshold -> single hard seek to the video clock', () => {
  assert.deepEqual(driftAction(12.0, 10.0, 1, T), { kind: 'seek', to: 10.0 });
  assert.deepEqual(driftAction(10.0, 12.0, 1, T), { kind: 'seek', to: 12.0 });
  assert.deepEqual(driftAction(11.0, 10.0, 1, T), { kind: 'seek', to: 10.0 }); // +hard exactly (ahead)
  assert.deepEqual(driftAction(10.0, 11.0, 1, T), { kind: 'seek', to: 11.0 }); // -hard exactly (behind)
});

test('rate nudge can never invert or stall playback', () => {
  // Even with a tiny base rate and a large nudge, the result stays positive.
  const a = driftAction(10.4, 10.0, 0.0625, { soft: 0.1, hard: 1.0, rateNudge: 0.5 });
  assert.equal(a.kind, 'rate');
  assert.ok(a.kind === 'rate' && a.playbackRate >= 0.0625, 'playbackRate must stay positive');
});

test('non-finite clocks -> no correction (never NaN-seek)', () => {
  assert.deepEqual(driftAction(NaN, 10, 1, T), { kind: 'none' });
  assert.deepEqual(driftAction(10, Infinity, 1, T), { kind: 'none' });
});

test('canResumeAudio: ready and not seeking -> true', () => {
  assert.equal(AUDIO_READY_THRESHOLD, 3); // HAVE_FUTURE_DATA
  assert.equal(canResumeAudio(3, false), true); // exactly the threshold
  assert.equal(canResumeAudio(4, false), true); // HAVE_ENOUGH_DATA
});

test('canResumeAudio: under-buffered or seeking -> false (defer to canplay/seeked)', () => {
  assert.equal(canResumeAudio(2, false), false); // HAVE_CURRENT_DATA, not enough
  assert.equal(canResumeAudio(0, false), false); // HAVE_NOTHING
  assert.equal(canResumeAudio(3, true), false); // ready but mid-seek
  assert.equal(canResumeAudio(4, true), false);
});

test('shouldCorrectDrift: only when both elements are playing and not seeking', () => {
  assert.equal(shouldCorrectDrift(false, false, false, false), true); // playing, settled
  assert.equal(shouldCorrectDrift(true, false, false, false), false); // audio paused (deferred)
  assert.equal(shouldCorrectDrift(false, true, false, false), false); // video paused
  assert.equal(shouldCorrectDrift(false, false, true, false), false); // audio mid-seek
  assert.equal(shouldCorrectDrift(false, false, false, true), false); // video mid-seek
});

test('isBenignPlayError: autoplay/abort are benign, real failures surface', () => {
  assert.equal(isBenignPlayError('AbortError'), true); // pause/seek interrupted play
  assert.equal(isBenignPlayError('NotAllowedError'), true); // autoplay blocked
  assert.equal(isBenignPlayError('NotSupportedError'), false); // real: surface it
  assert.equal(isBenignPlayError(''), false);
  assert.equal(isBenignPlayError('AbortError '), false); // exact match only
});
