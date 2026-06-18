import type MarkdownIt from 'markdown-it';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import type { RenderRule } from 'markdown-it/lib/renderer.mjs';
import type Token from 'markdown-it/lib/token.mjs';

// Render-time transform that turns local video references into a muted <video>
// paired with a sibling <audio> element, so the built-in Markdown preview can
// play them with sound. This is the M0 spike layer: it only rewrites markup and
// derives the sibling audio path; ffmpeg extraction and caching arrive in M2.
//
// Communication is one-way (see spec "重要な技術前提"): everything the preview
// script needs is embedded here at render time via data-* attributes.

export type VideoSrcKind = 'local-video' | 'webm' | 'remote' | 'not-video';

export interface VideoAudioOptions {
  // Extension of the sibling audio file. M0 assumes a pre-placed file next to
  // the video (e.g. clip.mp4 -> clip.mp3); M2 replaces this with extraction.
  audioExt?: string;
}

function stripQueryAndHash(src: string): string {
  return src.trim().split(/[?#]/, 1)[0] ?? '';
}

function isRemoteSrc(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

function normalizeAudioExt(audioExt: string): string {
  return audioExt.replace(/^\.+/, '') || 'mp3';
}

function renderPlayerBlock(md: MarkdownIt, videoSrc: string, audioExt: string): string {
  const cleanVideoSrc = stripQueryAndHash(videoSrc);
  const audioSrc = audioSrcFor(cleanVideoSrc, audioExt);
  const escapedVideoSrc = md.utils.escapeHtml(cleanVideoSrc);
  const escapedAudioSrc = md.utils.escapeHtml(audioSrc);

  return [
    `<div class="mdva-player" data-mdva="1" data-mdva-status="ready" data-mdva-audio="${escapedAudioSrc}">`,
    `<video class="mdva-video" src="${escapedVideoSrc}" muted controls preload="metadata"></video>`,
    `<audio class="mdva-audio" src="${escapedAudioSrc}" preload="auto"></audio>`,
    '</div>',
  ].join('');
}

function renderDefault(
  defaultRule: RenderRule | undefined,
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: unknown,
  self: Renderer,
): string {
  if (defaultRule) {
    return defaultRule(tokens, idx, options, env, self);
  }

  return self.renderToken(tokens, idx, options);
}

// Classify a video src so the transform knows whether to rewrite it.
//   - local-video : local .mp4 / .mov (rewritten to muted video + sibling audio)
//   - webm        : local .webm (passes through; the webview decodes its audio)
//   - remote      : http(s):// or protocol-relative URL (passes through)
//   - not-video   : anything else (images, other links — passes through)
// Case-insensitive on the extension; ignores ?query and #hash.
export function classifyVideoSrc(src: string): VideoSrcKind {
  if (isRemoteSrc(src)) {
    return 'remote';
  }

  const path = stripQueryAndHash(src).toLowerCase();
  if (path.endsWith('.mp4') || path.endsWith('.mov')) {
    return 'local-video';
  }

  if (path.endsWith('.webm')) {
    return 'webm';
  }

  return 'not-video';
}

// Derive the sibling audio src for a given video src, preserving the directory
// and base name and swapping the extension. Strips ?query / #hash.
//   audioSrcFor('dir/clip.mp4', 'mp3') -> 'dir/clip.mp3'
export function audioSrcFor(videoSrc: string, audioExt = 'mp3'): string {
  const path = stripQueryAndHash(videoSrc);
  const ext = normalizeAudioExt(audioExt);

  return path.replace(/\.[^./\\]*$/, `.${ext}`);
}

// Register markdown-it rules that rewrite local video references (both
// <video src="..."> raw HTML and ![](clip.mp4) image syntax) into the player
// block contract documented in test/transform.test.ts. Returns the same md.
export function applyVideoAudioRules(md: MarkdownIt, opts: VideoAudioOptions = {}): MarkdownIt {
  const audioExt = normalizeAudioExt(opts.audioExt ?? 'mp3');
  const defaultHtmlBlock = md.renderer.rules.html_block;
  const defaultHtmlInline = md.renderer.rules.html_inline;
  const defaultImage = md.renderer.rules.image;
  const videoTagPattern =
    /<video\b(?=[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+)))[^>]*>(?:[\s\S]*?<\/video>)?/gi;

  const renderHtml = (
    tokens: Token[],
    idx: number,
    options: MarkdownIt.Options,
    env: unknown,
    self: Renderer,
  ): string => {
    const token = tokens[idx];
    let rewritten = false;
    const content = token.content.replace(videoTagPattern, (match, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
      const src = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
      if (classifyVideoSrc(src) !== 'local-video') {
        return match;
      }

      rewritten = true;
      return renderPlayerBlock(md, src, audioExt);
    });

    if (rewritten) {
      return content;
    }

    const defaultRule = token.type === 'html_inline' ? defaultHtmlInline : defaultHtmlBlock;
    return renderDefault(defaultRule, tokens, idx, options, env, self);
  };

  md.renderer.rules.html_block = renderHtml;
  md.renderer.rules.html_inline = renderHtml;

  md.renderer.rules.image = (
    tokens: Token[],
    idx: number,
    options: MarkdownIt.Options,
    env: unknown,
    self: Renderer,
  ): string => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src && classifyVideoSrc(src) === 'local-video') {
      return renderPlayerBlock(md, src, audioExt);
    }

    return renderDefault(defaultImage, tokens, idx, options, env, self);
  };

  return md;
}
