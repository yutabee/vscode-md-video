import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { applyVideoAudioRules } from './transform';
import { createExtractionDriver, type ExtractionDriver } from './media/previewExtraction';

// Extension entry. The Markdown preview calls extendMarkdownIt() to let us
// rewrite video tokens at render time.
//
// Done so far: the render-time markup rewrite (muted <video> + sibling <audio>),
// preview-side sync, and (M4) automatic ffmpeg extraction wired into the render
// path via the injected resolver.
// Remaining milestones:
//   M1 (done): vscode-free ffmpeg audio-extraction engine (src/media/audio.ts).
//   M4 (done): wire automatic extraction into the transform/preview — the M1
//              engine drives the <audio> src through src/media/previewExtraction.
//   M5       : ffmpegPath / cacheDirName settings (override the M4 defaults).
//   M6       : maxSyncDriftMs + autoplay.
//   M7       : packaging / CI / docs.

// The driver owns the per-target extraction state and the debounced preview
// refresh; it must outlive a single render (the preview re-renders to pick up a
// finished extraction), so it is created once at activate() and disposed at
// deactivate(). Module-level so deactivate() — which gets no context — can reach
// it; the extension host runs one instance per window.
let driver: ExtractionDriver | undefined;

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt(md: MarkdownIt): MarkdownIt } {
  driver = createExtractionDriver();
  context.subscriptions.push({ dispose: () => driver?.dispose() });

  return {
    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      const config = vscode.workspace.getConfiguration('markdownVideoAudio');
      const enabled = config.get<boolean>('enabled', true);

      return applyVideoAudioRules(md, { enabled, resolveAudio: driver?.resolveAudio });
    },
  };
}

export function deactivate(): void {
  driver?.dispose();
  driver = undefined;
}
