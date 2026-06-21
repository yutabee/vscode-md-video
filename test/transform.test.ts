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
// pre-placed file; M4 will extract it with ffmpeg). webm / remote / non-video
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

test('classifyVideoSrc: local m4v -> local-video', () => {
  assert.equal(classifyVideoSrc('clip.m4v'), 'local-video');
  assert.equal(classifyVideoSrc('a/b/clip.m4v'), 'local-video');
  assert.equal(classifyVideoSrc('clip.M4V'), 'local-video');
  assert.equal(classifyVideoSrc('clip.m4v?t=1'), 'local-video');
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

test('transform: <video src=*.m4v> becomes a player block', () => {
  const out = render('<video src="clip.m4v" controls></video>');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /<video[^>]*\bmuted\b/);
  assert.match(out, /<video[^>]*\bsrc="clip\.m4v"/);
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

test('transform: ![](clip.m4v) image syntax becomes a player block', () => {
  const out = render('![](clip.m4v)');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /<video[^>]*\bsrc="clip\.m4v"/);
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

// --- classifyVideoSrc: safety allowlist (relative paths only) ----------------

test('classifyVideoSrc: allows safe relative paths including ./', () => {
  assert.equal(classifyVideoSrc('clip.mp4'), 'local-video');
  assert.equal(classifyVideoSrc('./clip.mp4'), 'local-video');
  assert.equal(classifyVideoSrc('a/b/clip.mp4'), 'local-video');
});

test('classifyVideoSrc: rejects URL schemes as not-video', () => {
  assert.equal(classifyVideoSrc('file:///a.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('data:video/mp4,AAAA.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('javascript:alert(1).mp4'), 'not-video');
  assert.equal(classifyVideoSrc('vscode:/x.mp4'), 'not-video');
});

test('classifyVideoSrc: rejects absolute / UNC / drive paths as not-video', () => {
  assert.equal(classifyVideoSrc('/abs/path.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('\\\\host\\share\\a.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('C:\\dir\\a.mp4'), 'not-video');
  // M2: the safety gate must fire before .m4v format classification too.
  assert.equal(classifyVideoSrc('/abs/x.m4v'), 'not-video');
});

test('classifyVideoSrc: rejects traversal segments as not-video', () => {
  assert.equal(classifyVideoSrc('../secret.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('dir/../a.mp4'), 'not-video');
  // M2: .m4v must not widen the attack surface past isSafeRelativeSrc.
  assert.equal(classifyVideoSrc('../secret.m4v'), 'not-video');
});

test('classifyVideoSrc: rejects percent-encoded traversal as not-video', () => {
  // The webview decodes %2e%2e -> .. (and %2f -> /) with URL semantics, so an
  // encoded path could climb out of the document dir past the literal-`..`
  // check. The path component must reject `%` entirely.
  assert.equal(classifyVideoSrc('%2e%2e/secret.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('a/%2e%2e/secret.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('..%2fsecret.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('a%2fb.mp4'), 'not-video');
  // A legitimate query may still carry `%` (only the path is restricted).
  assert.equal(classifyVideoSrc('clip.mp4?t=1%202'), 'local-video');
});

test('classifyVideoSrc: rejects control characters as not-video', () => {
  assert.equal(classifyVideoSrc('a\u0000.mp4'), 'not-video');
  assert.equal(classifyVideoSrc('a\nb.mp4'), 'not-video');
});

// --- transform: quote-aware scanner robustness ------------------------------

test('transform: data-src is not treated as src (no rewrite)', () => {
  assert.doesNotMatch(render('<video data-src="clip.mp4"></video>'), /data-mdva="1"/);
});

test('transform: ng-src / :src are not treated as src (no rewrite)', () => {
  assert.doesNotMatch(render('<video ng-src="clip.mp4"></video>'), /data-mdva="1"/);
  assert.doesNotMatch(render('<video :src="clip.mp4"></video>'), /data-mdva="1"/);
});

test('transform: > inside a quoted attribute does not break the match', () => {
  const out = render('<video title="x > y" src="clip.mp4"></video>');
  assert.match(out, /data-mdva="1"/);
  assert.match(out, /<video[^>]*\bsrc="clip\.mp4"/);
});

test('transform: src before a quoted-> attribute consumes the whole tag', () => {
  const out = render('<video src="clip.mp4" title="x > y"></video>');
  assert.match(out, /data-mdva="1"/);
  // The leftover ' y">' must not survive as stray text.
  assert.doesNotMatch(out, /\sy">/);
});

test('transform: pseudo <video> inside an HTML comment is left untouched', () => {
  assert.doesNotMatch(render('<!-- <video src="clip.mp4"></video> -->'), /data-mdva="1"/);
});

test('transform: multiple <video> tags are all rewritten', () => {
  const out = render('<video src="a.mp4"></video><video src="b.mp4"></video>');
  assert.equal((out.match(/data-mdva="1"/g) ?? []).length, 2);
});

// --- transform: clean block promotion (no orphan </video>, no <p> nesting) ---

test('transform: raw <video> emits no orphan </video> and no <p> wrapping', () => {
  const out = render('<video src="clip.mp4" controls></video>');
  assert.match(out, /data-mdva="1"/);
  // Exactly one </video> — the one inside the player block; no leaked sibling.
  assert.equal((out.match(/<\/video>/g) ?? []).length, 1);
  // The player <div> is a block sibling, never nested inside a <p>.
  assert.doesNotMatch(out, /<p>\s*<div class="mdva-player"/);
  assert.doesNotMatch(out, /<\/div>\s*<\/p>/);
});

test('transform: multiple raw <video> tags promote without orphan close tags', () => {
  const out = render('<video src="a.mp4"></video><video src="b.mp4"></video>');
  // Two players => two </video>, with no stray third from a leaked close tag.
  assert.equal((out.match(/<\/video>/g) ?? []).length, 2);
  assert.doesNotMatch(out, /<\/div>\s*<\/p>/);
});

test('transform: multi-line <video> block is rewritten cleanly', () => {
  const out = render('<video src="clip.mp4">\n</video>');
  assert.match(out, /data-mdva="1"/);
  assert.equal((out.match(/<\/video>/g) ?? []).length, 1);
  assert.match(out, /<audio[^>]*\bsrc="clip\.mp3"/);
});

test('transform: unsafe src in raw HTML is left untouched', () => {
  assert.doesNotMatch(render('<video src="../secret.mp4"></video>'), /data-mdva="1"/);
  assert.doesNotMatch(render('<video src="/abs/a.mp4"></video>'), /data-mdva="1"/);
});

// --- transform: video src keeps query/hash, audio strips it -----------------

test('transform: video keeps query/hash, audio src is the stripped sibling', () => {
  const out = render('<video src="clip.mp4?t=10"></video>');
  assert.match(out, /<video[^>]*\bsrc="clip\.mp4\?t=10"/);
  assert.match(out, /<audio[^>]*\bsrc="clip\.mp3"/);
});

// --- transform: image block-promotion only when alone in a paragraph --------

test('transform: ![](clip.mp4) alone in a paragraph is not wrapped in <p>', () => {
  const out = render('![](clip.mp4)');
  assert.match(out, /data-mdva="1"/);
  assert.doesNotMatch(out, /<p>\s*<div class="mdva-player"/);
});

test('transform: a video image mixed inline with text is not block-promoted', () => {
  const out = render('text ![](clip.mp4) more');
  assert.doesNotMatch(out, /data-mdva="1"/);
  assert.match(out, /<img[^>]*\bsrc="clip\.mp4"/);
});

// --- transform: plugin delegation + enabled toggle --------------------------

test('transform: delegates to a previously registered image rule for non-video', () => {
  const md = new MarkdownIt({ html: true });
  md.renderer.rules.image = () => '<custom-img>';
  applyVideoAudioRules(md);
  assert.match(md.render('![](pic.png)'), /<custom-img>/);
});

test('transform: disabled option leaves everything untouched', () => {
  const md = applyVideoAudioRules(new MarkdownIt({ html: true }), { enabled: false });
  const out = md.render('<video src="clip.mp4"></video>');
  assert.doesNotMatch(out, /data-mdva/);
  assert.match(out, /clip\.mp4/);
});
