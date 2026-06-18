import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { applyVideoAudioRules, classifyVideoSrc, audioSrcFor } from '../src/transform';

// M0 spike acceptance contract.
//
// The transform rewrites local .mp4/.mov references (both <video src> raw HTML
// and ![](clip.mp4) image syntax) into a "player block":
//
//   <div class="mdva-player" data-mdva="1" data-mdva-status="ready"
//        data-mdva-audio="<audioRel>">
//     <video class="mdva-video" src="<videoRel>" muted controls ...></video>
//     <audio class="mdva-audio" src="<audioRel>" ...></audio>
//   </div>
//
// Audio src is the video's sibling with the extension swapped (M0 assumes a
// pre-placed file; M2 will extract it with ffmpeg). webm / remote / non-video
// references pass through untouched.

function render(input: string): string {
  const md = applyVideoAudioRules(new MarkdownIt({ html: true }));
  return md.render(input);
}

// --- classifyVideoSrc -------------------------------------------------------

test('classifyVideoSrc: local mp4/mov -> local-video', () => {
  assert.equal(classifyVideoSrc('clip.mp4'), 'local-video');
  assert.equal(classifyVideoSrc('a/b/clip.mov'), 'local-video');
});

test('classifyVideoSrc: extension is case-insensitive', () => {
  assert.equal(classifyVideoSrc('clip.MP4'), 'local-video');
  assert.equal(classifyVideoSrc('clip.MOV'), 'local-video');
});

test('classifyVideoSrc: ignores query and hash', () => {
  assert.equal(classifyVideoSrc('clip.mp4?t=1'), 'local-video');
  assert.equal(classifyVideoSrc('clip.mp4#frag'), 'local-video');
});

test('classifyVideoSrc: webm is its own kind (passthrough)', () => {
  assert.equal(classifyVideoSrc('movie.webm'), 'webm');
});

test('classifyVideoSrc: remote urls', () => {
  assert.equal(classifyVideoSrc('https://example.com/a.mp4'), 'remote');
  assert.equal(classifyVideoSrc('http://example.com/a.mp4'), 'remote');
  assert.equal(classifyVideoSrc('//cdn.example.com/a.mp4'), 'remote');
});

test('classifyVideoSrc: non-video references', () => {
  assert.equal(classifyVideoSrc('pic.png'), 'not-video');
  assert.equal(classifyVideoSrc('notes.md'), 'not-video');
});

// --- audioSrcFor ------------------------------------------------------------

test('audioSrcFor: swaps extension, default mp3', () => {
  assert.equal(audioSrcFor('clip.mp4'), 'clip.mp3');
});

test('audioSrcFor: preserves directory', () => {
  assert.equal(audioSrcFor('dir/sub/clip.mp4', 'mp3'), 'dir/sub/clip.mp3');
});

test('audioSrcFor: case-insensitive source extension', () => {
  assert.equal(audioSrcFor('clip.MP4', 'mp3'), 'clip.mp3');
});

test('audioSrcFor: strips query and hash', () => {
  assert.equal(audioSrcFor('clip.mp4?t=1', 'mp3'), 'clip.mp3');
  assert.equal(audioSrcFor('clip.mov#frag', 'mp3'), 'clip.mp3');
});

test('audioSrcFor: honours a custom extension', () => {
  assert.equal(audioSrcFor('a/b/clip.mov', 'm4a'), 'a/b/clip.m4a');
});

// --- transform: <video> raw HTML --------------------------------------------

test('transform: <video src=*.mp4> becomes a player block', () => {
  const out = render('<video src="clip.mp4" controls></video>');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /data-mdva-status="ready"/);
  assert.match(out, /data-mdva-audio="clip\.mp3"/);
  assert.match(out, /<video[^>]*\bmuted\b/);
  assert.match(out, /<video[^>]*\bsrc="clip\.mp4"/);
  assert.match(out, /<audio[^>]*\bsrc="clip\.mp3"/);
});

test('transform: <video src=*.MOV> (uppercase) is rewritten', () => {
  const out = render('<video src="clip.MOV"></video>');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /<audio[^>]*\bsrc="clip\.mp3"/);
});

// --- transform: image syntax ------------------------------------------------

test('transform: ![](clip.mp4) image syntax becomes a player block', () => {
  const out = render('![](clip.mp4)');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /<video[^>]*\bmuted\b/);
  assert.match(out, /<video[^>]*\bsrc="clip\.mp4"/);
  assert.match(out, /<audio[^>]*\bsrc="clip\.mp3"/);
});

// --- passthrough ------------------------------------------------------------

test('transform: local .webm is left untouched', () => {
  const out = render('<video src="movie.webm" controls></video>');
  assert.doesNotMatch(out, /data-mdva/);
  assert.match(out, /movie\.webm/);
});

test('transform: remote video is left untouched', () => {
  const out = render('<video src="https://example.com/a.mp4" controls></video>');
  assert.doesNotMatch(out, /data-mdva/);
  assert.match(out, /https:\/\/example\.com\/a\.mp4/);
});

test('transform: plain image is left as an image', () => {
  const out = render('![alt](pic.png)');
  assert.doesNotMatch(out, /data-mdva/);
  assert.match(out, /<img[^>]*\bsrc="pic\.png"/);
  assert.match(out, /\balt="alt"/);
});
