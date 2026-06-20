import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_EXTENSIONS, classifyMediaFormat } from '../src/media/mediaFormat';

// M2 acceptance contract for the pure media-format module.
//
// classifyMediaFormat maps a filesystem-style path (query/hash already stripped
// by the caller) to an audio-handling category:
//   - 'needs-sidecar' : AAC containers (.mp4/.mov/.m4v) the webview can't decode
//                       -> muted video + extracted/sibling mp3.
//   - 'native-audio'  : .webm, whose audio Chromium decodes from <video> itself.
//   - undefined       : not a recognized video container.
// It knows nothing about remote URLs or path safety — that stays in transform.ts.

test('VIDEO_EXTENSIONS covers the recognized containers', () => {
  assert.deepEqual([...VIDEO_EXTENSIONS], ['.mp4', '.mov', '.m4v', '.webm']);
});

test('classifyMediaFormat: AAC containers need a sidecar', () => {
  assert.equal(classifyMediaFormat('clip.mp4'), 'needs-sidecar');
  assert.equal(classifyMediaFormat('clip.mov'), 'needs-sidecar');
  assert.equal(classifyMediaFormat('clip.m4v'), 'needs-sidecar');
});

test('classifyMediaFormat: webm plays native audio', () => {
  assert.equal(classifyMediaFormat('movie.webm'), 'native-audio');
});

test('classifyMediaFormat: extension match is case-insensitive', () => {
  assert.equal(classifyMediaFormat('clip.M4V'), 'needs-sidecar');
  assert.equal(classifyMediaFormat('clip.MP4'), 'needs-sidecar');
  assert.equal(classifyMediaFormat('movie.WEBM'), 'native-audio');
});

test('classifyMediaFormat: keeps directory paths', () => {
  assert.equal(classifyMediaFormat('a/b/clip.m4v'), 'needs-sidecar');
});

test('classifyMediaFormat: non-video references are undefined', () => {
  assert.equal(classifyMediaFormat('pic.png'), undefined);
  assert.equal(classifyMediaFormat('notes.md'), undefined);
  assert.equal(classifyMediaFormat('noext'), undefined);
  // Only the final extension counts.
  assert.equal(classifyMediaFormat('archive.mp4.zip'), undefined);
});
