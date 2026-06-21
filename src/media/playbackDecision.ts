/**
 * Pure render-time decision for the Markdown-preview player. Given whether the
 * extracted-audio cache file already exists and what the host driver remembers
 * about prior extraction attempts, decide the player status and whether to kick
 * a new extraction. Kept free of any `vscode`/`fs` import so the state machine is
 * unit-tested in Node; the async IO glue lives in src/media/previewExtraction.ts.
 *
 * WHY a remembered state is required: the built-in Markdown preview is one-way
 * (the preview script cannot message the host), so the only way a freshly
 * extracted track reaches the DOM is a full re-render. A cache miss kicks
 * extraction and renders "preparing"; on completion the driver refreshes the
 * preview. Without remembering the terminal-negative outcomes (no-audio /
 * ffmpeg-not-found / error) the next render would again see "no cache file" and
 * re-kick forever. The content-addressed cache path keys this state, so editing
 * the video (new size/mtime -> new path) naturally retries from scratch.
 */

/** Player lifecycle status, mirrored by the status labels in webview/inject.ts. */
export type PlayerStatus = 'ready' | 'preparing' | 'no-audio' | 'ffmpeg-not-found' | 'error';

/** What the host driver remembers about an extraction target (keyed by cache path). */
export type ExtractionState = 'extracting' | 'no-audio' | 'ffmpeg-not-found' | 'error';

/** The audio the transform should emit for one video, decided by the driver. */
export interface AudioResolution {
  /** Relative <audio> src to emit; '' when not ready (no src attribute emitted). */
  readonly audioSrc: string;
  readonly status: PlayerStatus;
}

/**
 * Resolve the audio for one video src at render time. `env` is the markdown-it
 * render env, opaque here — the driver reads `env.currentDocument` (the VS Code
 * document URI). Returning the result synchronously keeps the transform pure;
 * any extraction is a side effect the driver fires and forgets.
 */
export type AudioResolver = (videoSrc: string, env: unknown) => AudioResolution;

export interface PlaybackDecision {
  readonly status: PlayerStatus;
  /** True when the caller should start a (deduped) extraction for this target. */
  readonly kick: boolean;
}

/**
 * Decide the player status from the on-disk cache and the remembered state.
 * An existing cache file wins over any remembered state (the track is there).
 * Otherwise: unseen -> kick + "preparing"; in flight -> "preparing" without a
 * second kick; a terminal-negative -> surface it without re-kicking.
 */
export function decidePlayback(cacheExists: boolean, state: ExtractionState | undefined): PlaybackDecision {
  if (cacheExists) {
    return { status: 'ready', kick: false };
  }

  switch (state) {
    case undefined:
      return { status: 'preparing', kick: true };
    case 'extracting':
      return { status: 'preparing', kick: false };
    case 'no-audio':
      return { status: 'no-audio', kick: false };
    case 'ffmpeg-not-found':
      return { status: 'ffmpeg-not-found', kick: false };
    case 'error':
      return { status: 'error', kick: false };
  }
}
