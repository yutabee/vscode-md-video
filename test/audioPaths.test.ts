import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cachePathFor, isPathWithinRoots } from '../src/media/audio';
import { makeTempDir, createCleanup } from '../test-support';

// M4 acceptance contract for the two synchronous path helpers the render-time
// transform relies on (audio.ts stays vscode-free so they are exercised in Node):
//   - cachePathFor: the canonical cache path the async extractor would write,
//     so a render can check existsSync (cache hit) and name the <audio> src.
//   - isPathWithinRoots: F4 boundary check — a video path derived from the
//     Markdown document must stay inside the document's allowed root before
//     ffmpeg ever sees it (catches symlink escapes the relative allowlist can't).

test('cachePathFor: mdva-audio-<key>.mp3 under the cache dir, stable per file', () => {
  const cleanup = createCleanup();
  try {
    const dir = cleanup.track(makeTempDir('mdva-cachepath'));
    const input = path.join(dir, 'clip.mp4');
    fs.writeFileSync(input, 'aaa');
    const cacheDir = path.join(dir, '.cache');

    const p1 = cachePathFor(input, cacheDir);
    assert.equal(path.dirname(p1), cacheDir);
    assert.match(path.basename(p1), /^mdva-audio-[0-9a-f]{16}\.mp3$/);
    // Deterministic for an unchanged file.
    assert.equal(cachePathFor(input, cacheDir), p1);
  } finally {
    cleanup.run();
  }
});

test('cachePathFor: editing the file in place yields a new path (content-addressed)', () => {
  const cleanup = createCleanup();
  try {
    const dir = cleanup.track(makeTempDir('mdva-cachepath'));
    const input = path.join(dir, 'clip.mp4');
    fs.writeFileSync(input, 'aaa');
    const cacheDir = path.join(dir, '.cache');
    const before = cachePathFor(input, cacheDir);

    // Change size + mtime; the key (and so the path) must change.
    fs.writeFileSync(input, 'aaaa-grown');
    const after = cachePathFor(input, cacheDir);
    assert.notEqual(after, before);
  } finally {
    cleanup.run();
  }
});

test('cachePathFor: throws when the input cannot be stat\'d (like extractAudio)', () => {
  const cleanup = createCleanup();
  try {
    const dir = cleanup.track(makeTempDir('mdva-cachepath'));
    assert.throws(() => cachePathFor(path.join(dir, 'missing.mp4'), path.join(dir, '.cache')));
  } finally {
    cleanup.run();
  }
});

test('isPathWithinRoots: a file inside a root is accepted', () => {
  const cleanup = createCleanup();
  try {
    const root = cleanup.track(makeTempDir('mdva-root'));
    const sub = path.join(root, 'media');
    fs.mkdirSync(sub);
    const file = path.join(sub, 'clip.mp4');
    fs.writeFileSync(file, 'x');
    assert.equal(isPathWithinRoots(file, [root]), true);
    // The root itself counts as within.
    assert.equal(isPathWithinRoots(root, [root]), true);
  } finally {
    cleanup.run();
  }
});

test('isPathWithinRoots: a sibling of the root is rejected (prefix is not containment)', () => {
  const cleanup = createCleanup();
  try {
    const base = cleanup.track(makeTempDir('mdva-base'));
    const root = path.join(base, 'ws');
    const sibling = path.join(base, 'ws-evil'); // shares the textual prefix "ws"
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    const file = path.join(sibling, 'a.mp4');
    fs.writeFileSync(file, 'x');
    assert.equal(isPathWithinRoots(file, [root]), false);
  } finally {
    cleanup.run();
  }
});

test('isPathWithinRoots: a symlink that escapes the root is rejected (realpath canonicalized)', () => {
  const cleanup = createCleanup();
  try {
    const base = cleanup.track(makeTempDir('mdva-symlink'));
    const root = path.join(base, 'ws');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    const secret = path.join(outside, 'secret.mp4');
    fs.writeFileSync(secret, 'x');

    // A symlink that lives inside the root but points outside it.
    const link = path.join(root, 'link.mp4');
    try {
      fs.symlinkSync(secret, link);
    } catch {
      return; // platform without symlink permission: nothing to assert
    }
    assert.equal(isPathWithinRoots(link, [root]), false);
  } finally {
    cleanup.run();
  }
});

test('isPathWithinRoots: empty roots / empty-string roots accept nothing', () => {
  const cleanup = createCleanup();
  try {
    const root = cleanup.track(makeTempDir('mdva-empty'));
    const file = path.join(root, 'a.mp4');
    fs.writeFileSync(file, 'x');
    assert.equal(isPathWithinRoots(file, []), false);
    assert.equal(isPathWithinRoots(file, ['', '   ']), false);
  } finally {
    cleanup.run();
  }
});
