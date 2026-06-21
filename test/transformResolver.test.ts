import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { applyVideoAudioRules } from '../src/transform';
import type { AudioResolution } from '../src/media/playbackDecision';

// M4 acceptance contract: the transform delegates the <audio> src + player
// status to an injected resolver (the host driver), staying pure itself. The
// default (no resolver) must keep the exact M0 sibling+ready emission — that
// regression is pinned in transform.test.ts; here we pin the injection seam.

function renderWith(resolveAudio: (videoSrc: string, env: unknown) => AudioResolution, input: string): string {
  const md = applyVideoAudioRules(new MarkdownIt({ html: true }), { resolveAudio });
  return md.render(input);
}

test('injected resolver drives the status and the <audio> src (ready)', () => {
  const out = renderWith(
    () => ({ audioSrc: '.cache/mdva-audio-deadbeefdeadbeef.mp3', status: 'ready' }),
    '<video src="clip.mp4"></video>',
  );
  assert.match(out, /data-mdva-status="ready"/);
  assert.match(out, /<audio[^>]*\bsrc="\.cache\/mdva-audio-deadbeefdeadbeef\.mp3"/);
  // The video src is untouched by the resolver.
  assert.match(out, /<video[^>]*\bsrc="clip\.mp4"/);
});

test('preparing resolution emits the status but no <audio src> (avoids a load error)', () => {
  const out = renderWith(() => ({ audioSrc: '', status: 'preparing' }), '![](clip.mp4)');
  assert.match(out, /data-mdva-status="preparing"/);
  // The <audio> element exists (inject.ts requires it) but carries no src.
  assert.match(out, /<audio class="mdva-audio" preload="auto"><\/audio>/);
  assert.doesNotMatch(out, /<audio[^>]*\bsrc=/);
});

test('terminal-negative statuses pass through to the data attribute, still srcless', () => {
  for (const status of ['no-audio', 'ffmpeg-not-found', 'error'] as const) {
    const out = renderWith(() => ({ audioSrc: '', status }), '<video src="clip.mp4"></video>');
    assert.match(out, new RegExp(`data-mdva-status="${status}"`));
    assert.doesNotMatch(out, /<audio[^>]*\bsrc=/);
  }
});

test('resolver receives the raw video src and the markdown-it render env', () => {
  const seen: Array<{ src: string; env: unknown }> = [];
  const md = applyVideoAudioRules(new MarkdownIt({ html: true }), {
    resolveAudio: (videoSrc, env) => {
      seen.push({ src: videoSrc, env });
      return { audioSrc: '', status: 'preparing' };
    },
  });
  const env = { currentDocument: { marker: true } };
  md.render('<video src="dir/clip.mp4"></video>', env);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].src, 'dir/clip.mp4');
  assert.equal(seen[0].env, env); // the same env object is threaded through
});

test('html escaping still applies to a resolver-provided audio src', () => {
  const out = renderWith(
    () => ({ audioSrc: 'a&b".mp3', status: 'ready' }),
    '<video src="clip.mp4"></video>',
  );
  assert.match(out, /src="a&amp;b&quot;\.mp3"/);
  assert.doesNotMatch(out, /a&b"\.mp3/);
});
