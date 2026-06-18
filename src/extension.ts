import type MarkdownIt from 'markdown-it';

// Extension entry. The Markdown preview calls extendMarkdownIt() to let us
// rewrite video tokens at render time.
//
// Scaffold only — feature logic is implemented per the spec milestones:
//   M0 spike  : verify a md-relative <audio> resolves to a webview resource and
//               plays under the built-in preview's default CSP.
//   M1 inject : rewrite <video> / video links, embed data-* + <audio>; sync in preview script.
//   M2 extract: ffmpeg audio extraction job + cache (realpath+mtime+size) + preview refresh.
//   M3 syntax : ![]() / bare links / <source> / query+hash / extension case; webm passthrough; autoplay.
//   M4 config : settings, enabled toggle, drift validation, .gitignore hint.
export function activate(): { extendMarkdownIt(md: MarkdownIt): MarkdownIt } {
  return {
    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      // TODO(M1): register a rule that rewrites local video tokens into a
      // muted <video> + status data-* + md-relative <audio>.
      return md;
    },
  };
}

export function deactivate(): void {
  // no-op
}
