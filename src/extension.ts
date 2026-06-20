import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { applyVideoAudioRules } from './transform';

// Extension entry. The Markdown preview calls extendMarkdownIt() to let us
// rewrite video tokens at render time.
//
// Done so far: the render-time markup rewrite (muted <video> + sibling <audio>)
// and preview-side sync. Sources still assume a pre-placed sibling audio file.
// Remaining milestones:
//   M1 (done): vscode-free ffmpeg audio-extraction engine (src/media/audio.ts),
//              unit-tested but not yet wired in.
//   M2       : media-format classification (.m4v routing, needs-sidecar vs native).
//   M3       : preview-side sync drift policy.
//   M4       : wire automatic extraction into the transform/preview — the M1
//              engine goes live here, replacing the pre-placed-file assumption.
//   M5       : ffmpegPath / cacheDir settings + trust gating.
//   M6       : maxSyncDriftMs + autoplay.
//   M7       : packaging / CI / docs.
export function activate(): { extendMarkdownIt(md: MarkdownIt): MarkdownIt } {
  return {
    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      const config = vscode.workspace.getConfiguration('markdownVideoAudio');
      const enabled = config.get<boolean>('enabled', true);

      return applyVideoAudioRules(md, { enabled });
    },
  };
}

export function deactivate(): void {
  // no-op
}
