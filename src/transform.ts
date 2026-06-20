import type MarkdownIt from 'markdown-it';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import type { RenderRule } from 'markdown-it/lib/renderer.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';

// Render-time transform that turns local video references into a muted <video>
// paired with a sibling <audio> element, so the built-in Markdown preview can
// play them with sound. This layer only rewrites markup and derives the sibling
// audio path; on-demand ffmpeg extraction (the M1 engine in src/media/audio.ts,
// built but not yet wired) arrives in M4.
//
// Communication is one-way (see spec "重要な技術前提"): everything the preview
// script needs is embedded here at render time via data-* attributes.

export type VideoSrcKind = 'local-video' | 'webm' | 'remote' | 'not-video';

export interface VideoAudioOptions {
  // When disabled, leave markdown-it untouched so previously registered rules
  // keep their exact behavior.
  enabled?: boolean;
  // Extension of the sibling audio file. For now a pre-placed file is assumed
  // next to the video (e.g. clip.mp4 -> clip.mp3); M4 replaces this with
  // on-demand extraction via the M1 engine.
  audioExt?: string;
}

function stripQueryAndHash(src: string): string {
  return src.trim().split(/[?#]/, 1)[0] ?? '';
}

function isRemoteSrc(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

function hasWhitespaceOrControl(src: string): boolean {
  return Array.from(src).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
}

function isSafeRelativeSrc(src: string): boolean {
  const trimmed = src.trim();
  if (hasWhitespaceOrControl(src)) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return false;
  }

  if (trimmed.includes('\\')) {
    return false;
  }

  const path = stripQueryAndHash(trimmed);
  if (path.startsWith('/')) {
    return false;
  }

  return !path.split('/').includes('..');
}

function normalizeAudioExt(audioExt: string): string {
  return audioExt.replace(/^\.+/, '') || 'mp3';
}

function renderPlayerBlock(md: MarkdownIt, videoSrc: string, audioExt: string): string {
  const cleanVideoSrc = videoSrc.trim();
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

function isWhitespaceOnlyText(token: Token): boolean {
  return token.type === 'text' && token.content.trim() === '';
}

function onlyChildImageToken(token: Token): Token | undefined {
  const meaningfulChildren = (token.children ?? []).filter((child) => !isWhitespaceOnlyText(child));
  if (meaningfulChildren.length !== 1) {
    return undefined;
  }

  const child = meaningfulChildren[0];
  return child.type === 'image' ? child : undefined;
}

function isNameBoundary(value: string, index: number): boolean {
  if (index >= value.length) {
    return true;
  }

  return /[\s>/]/.test(value[index]);
}

function startsWithIgnoreCase(value: string, search: string, index: number): boolean {
  return value.slice(index, index + search.length).toLowerCase() === search;
}

function isVideoOpenTagStart(value: string, index: number): boolean {
  return startsWithIgnoreCase(value, '<video', index) && isNameBoundary(value, index + '<video'.length);
}

function isVideoCloseTagStart(value: string, index: number): boolean {
  return startsWithIgnoreCase(value, '</video', index) && isNameBoundary(value, index + '</video'.length);
}

function findTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function isAttributeBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s=/>]/.test(char);
}

function readVideoSrcAttribute(tag: string): string | undefined {
  let index = '<video'.length;
  const end = tag.length - 1;

  while (index < end) {
    while (index < end && /\s/.test(tag[index])) {
      index += 1;
    }

    if (index >= end || tag[index] === '/') {
      index += 1;
      continue;
    }

    const nameStart = index;
    while (index < end && !isAttributeBoundary(tag[index])) {
      index += 1;
    }

    const name = tag.slice(nameStart, index);
    while (index < end && /\s/.test(tag[index])) {
      index += 1;
    }

    if (tag[index] !== '=') {
      continue;
    }

    index += 1;
    while (index < end && /\s/.test(tag[index])) {
      index += 1;
    }

    let value: string;
    const quote = tag[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      const valueStart = index;
      while (index < end && tag[index] !== quote) {
        index += 1;
      }
      value = tag.slice(valueStart, index);
      if (index < end) {
        index += 1;
      }
    } else {
      const valueStart = index;
      while (index < end && !/[\s>]/.test(tag[index])) {
        index += 1;
      }
      value = tag.slice(valueStart, index);
    }

    if (name.toLowerCase() === 'src') {
      return value;
    }
  }

  return undefined;
}

function findVideoCloseEnd(value: string, start: number): number | undefined {
  let index = start;

  while (index < value.length) {
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + '<!--'.length);
      if (commentEnd === -1) {
        return undefined;
      }
      index = commentEnd + '-->'.length;
      continue;
    }

    if (isVideoCloseTagStart(value, index)) {
      const closeEnd = findTagEnd(value, index);
      return closeEnd === -1 ? undefined : closeEnd + 1;
    }

    index += 1;
  }

  return undefined;
}

function rewriteVideoHtml(content: string, md: MarkdownIt, audioExt: string): string | undefined {
  let rewritten = false;
  let output = '';
  let index = 0;

  while (index < content.length) {
    if (content.startsWith('<!--', index)) {
      const commentEnd = content.indexOf('-->', index + '<!--'.length);
      const nextIndex = commentEnd === -1 ? content.length : commentEnd + '-->'.length;
      output += content.slice(index, nextIndex);
      index = nextIndex;
      continue;
    }

    if (!isVideoOpenTagStart(content, index)) {
      output += content[index];
      index += 1;
      continue;
    }

    const tagEnd = findTagEnd(content, index);
    if (tagEnd === -1) {
      output += content.slice(index);
      break;
    }

    const tag = content.slice(index, tagEnd + 1);
    const src = readVideoSrcAttribute(tag);
    if (!src || classifyVideoSrc(src) !== 'local-video') {
      output += tag;
      index = tagEnd + 1;
      continue;
    }

    const replacementEnd = findVideoCloseEnd(content, tagEnd + 1) ?? tagEnd + 1;
    output += renderPlayerBlock(md, src, audioExt);
    index = replacementEnd;
    rewritten = true;
  }

  return rewritten ? output : undefined;
}

// Classify a video src so the transform knows whether to rewrite it.
//   - local-video : local .mp4 / .mov (rewritten to muted video + sibling audio)
//   - webm        : local .webm (passes through; the webview decodes its audio)
//   - remote      : http(s):// or protocol-relative URL (passes through)
//   - not-video   : anything else, including unsafe local-looking paths
// Case-insensitive on the extension; ignores ?query and #hash for extension checks.
export function classifyVideoSrc(src: string): VideoSrcKind {
  if (isRemoteSrc(src)) {
    return 'remote';
  }

  if (!isSafeRelativeSrc(src)) {
    return 'not-video';
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

// Read the src of a single <video …> opening tag held in one html_inline token.
// markdown-it emits each raw inline tag as its own token, so the token content
// is exactly one tag. Returns undefined when it is not a bare <video> open tag.
function videoOpenTagSrc(content: string): string | undefined {
  const tag = content.trim();
  if (!isVideoOpenTagStart(tag, 0)) {
    return undefined;
  }

  const tagEnd = findTagEnd(tag, 0);
  if (tagEnd !== tag.length - 1) {
    return undefined;
  }

  return readVideoSrcAttribute(tag);
}

function isVideoCloseTagToken(content: string): boolean {
  return /^<\/video\s*>$/i.test(content.trim());
}

// Promote a paragraph whose entire meaningful content is one or more local
// <video> elements into a sequence of player blocks. Anything else (text mixed
// in, a non-local video, an unbalanced tag) leaves the paragraph untouched so
// markdown-it renders it normally.
function renderVideoParagraph(
  children: Token[],
  md: MarkdownIt,
  audioExt: string,
): string | undefined {
  const blocks: string[] = [];
  let index = 0;

  while (index < children.length) {
    const child = children[index];
    if (isWhitespaceOnlyText(child)) {
      index += 1;
      continue;
    }

    if (child.type !== 'html_inline') {
      return undefined;
    }

    const src = videoOpenTagSrc(child.content);
    if (src === undefined || classifyVideoSrc(src) !== 'local-video') {
      return undefined;
    }

    let close = index + 1;
    while (
      close < children.length &&
      !(children[close].type === 'html_inline' && isVideoCloseTagToken(children[close].content))
    ) {
      close += 1;
    }
    if (close >= children.length) {
      return undefined;
    }

    blocks.push(renderPlayerBlock(md, src, audioExt));
    index = close + 1;
  }

  return blocks.length > 0 ? blocks.join('') : undefined;
}

// Decide how to render a paragraph that may be media-only: a single
// ![](clip.mp4) image, or one or more raw <video> elements. Returns player
// block markup, or undefined to leave the paragraph as markdown-it rendered it.
function renderParagraphMedia(
  inline: Token,
  md: MarkdownIt,
  audioExt: string,
): string | undefined {
  const image = onlyChildImageToken(inline);
  if (image) {
    const src = image.attrGet('src');
    if (src && classifyVideoSrc(src) === 'local-video') {
      return renderPlayerBlock(md, src, audioExt);
    }
    return undefined;
  }

  return renderVideoParagraph(inline.children ?? [], md, audioExt);
}

// Register markdown-it rules that rewrite local video references (both
// <video src="..."> raw HTML and ![](clip.mp4) image syntax) into the player
// block contract documented in test/transform.test.ts. Returns the same md.
export function applyVideoAudioRules(md: MarkdownIt, opts: VideoAudioOptions = {}): MarkdownIt {
  if (opts.enabled === false) {
    return md;
  }

  const audioExt = normalizeAudioExt(opts.audioExt ?? 'mp3');
  const defaultHtmlBlock = md.renderer.rules.html_block;

  // Block-level raw HTML (e.g. a multi-line <video>…</video>) arrives as one
  // html_block token whose content holds the whole element, so rewriting it in
  // place is safe — no orphan close tag, and it already renders outside any <p>.
  // Single-line inline <video> tags are handled by the core ruler below instead:
  // markdown-it splits them into separate html_inline tokens, so rewriting at
  // render time would leak a </video> and nest the player <div> inside a <p>.
  md.renderer.rules.html_block = (
    tokens: Token[],
    idx: number,
    options: MarkdownIt.Options,
    env: unknown,
    self: Renderer,
  ): string => {
    const content = rewriteVideoHtml(tokens[idx].content, md, audioExt);
    if (content !== undefined) {
      return content;
    }

    return renderDefault(defaultHtmlBlock, tokens, idx, options, env, self);
  };

  md.core.ruler.after('inline', 'mdva_player', (state: StateCore) => {
    const tokens = state.tokens;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      const paragraphOpen = tokens[index];
      const inline = tokens[index + 1];
      const paragraphClose = tokens[index + 2];
      if (
        paragraphOpen.type !== 'paragraph_open' ||
        inline.type !== 'inline' ||
        paragraphClose.type !== 'paragraph_close'
      ) {
        continue;
      }

      const content = renderParagraphMedia(inline, md, audioExt);
      if (content === undefined) {
        continue;
      }

      const token = new state.Token('mdva_player', '', 0);
      token.block = true;
      token.map = paragraphOpen.map;
      token.level = paragraphOpen.level;
      token.content = content;
      tokens.splice(index, 3, token);
    }
  });

  md.renderer.rules.mdva_player = (tokens: Token[], idx: number): string => {
    return tokens[idx].content;
  };

  return md;
}
