// Pure media-format classification — no vscode, no node imports, so it stays
// unit-testable in isolation (same discipline as src/media/audio.ts). It owns
// the single source of truth for which container extensions this extension
// recognizes and how their audio reaches the Markdown preview. transform.ts
// keeps the URL concerns (remote, path safety, query/hash) and delegates the
// extension decision here.

/** Recognized video container extensions (lowercase, leading dot). */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'] as const;

/**
 * How a recognized video's audio reaches the preview:
 *   - 'needs-sidecar' : AAC containers (.mp4/.mov/.m4v). The codec-less Chromium
 *                       webview can't decode AAC, so the video plays muted and
 *                       relies on a sibling/extracted mp3.
 *   - 'native-audio'  : .webm (VP8/VP9 + Vorbis/Opus), decoded by the webview
 *                       straight from the <video> element — no sidecar.
 */
export type MediaAudioKind = 'needs-sidecar' | 'native-audio';

/**
 * Classify a filesystem-style path by its extension. Expects query/hash to be
 * already stripped by the caller (transform.ts strips them before calling).
 * Returns undefined for anything that is not a recognized video container.
 * Matches on the trailing extension only and is case-insensitive.
 */
export function classifyMediaFormat(path: string): MediaAudioKind | undefined {
  const lower = path.toLowerCase();
  const ext = VIDEO_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  if (!ext) {
    return undefined;
  }

  return ext === '.webm' ? 'native-audio' : 'needs-sidecar';
}
