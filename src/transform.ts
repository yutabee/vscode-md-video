import type MarkdownIt from 'markdown-it';

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

// Classify a video src so the transform knows whether to rewrite it.
//   - local-video : local .mp4 / .mov (rewritten to muted video + sibling audio)
//   - webm        : local .webm (passes through; the webview decodes its audio)
//   - remote      : http(s):// or protocol-relative URL (passes through)
//   - not-video   : anything else (images, other links — passes through)
// Case-insensitive on the extension; ignores ?query and #hash.
export function classifyVideoSrc(_src: string): VideoSrcKind {
  // TODO(M0): implement.
  return 'not-video';
}

// Derive the sibling audio src for a given video src, preserving the directory
// and base name and swapping the extension. Strips ?query / #hash.
//   audioSrcFor('dir/clip.mp4', 'mp3') -> 'dir/clip.mp3'
export function audioSrcFor(_videoSrc: string, _audioExt = 'mp3'): string {
  // TODO(M0): implement.
  return '';
}

// Register markdown-it rules that rewrite local video references (both
// <video src="..."> raw HTML and ![](clip.mp4) image syntax) into the player
// block contract documented in test/transform.test.ts. Returns the same md.
export function applyVideoAudioRules(md: MarkdownIt, _opts?: VideoAudioOptions): MarkdownIt {
  // TODO(M0): implement.
  return md;
}
