/**
 * M4 host-side glue: the resolver the extension injects into the transform.
 *
 * The built-in Markdown preview renders synchronously in the extension host, but
 * ffmpeg extraction is async and the preview is one-way (the webview cannot
 * message us back). The bridge:
 *
 *   render -> resolveAudio() decides a player status from the on-disk cache and a
 *   remembered extraction state (pure: src/media/playbackDecision.ts). A cache
 *   HIT emits status=ready + the relative cache-file src. A MISS emits
 *   status=preparing and kicks ffmpeg as a fire-and-forget side effect; on
 *   completion a debounced `markdown.preview.refresh` re-renders, so the next
 *   render is a HIT and the audio plays.
 *
 * This is the only module that imports `vscode`; the decision logic, path
 * helpers and the engine it drives are all vscode-free and unit-tested. F4
 * (input-path validation) lives here: a video's absolute path is derived from
 * the Markdown document's location and confirmed to stay within the preview's
 * allowed resource roots before any extraction touches it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { cachePathFor, extractAudio, findFfmpeg, isPathWithinRoots } from './audio';
import { decidePlayback } from './playbackDecision';
import type { AudioResolution, AudioResolver, ExtractionState } from './playbackDecision';
import { audioSrcFor } from '../transform';

/**
 * Directory (under the Markdown document's own folder) the extracted-audio cache
 * lives in. Hardcoded in M4; the `markdownVideoAudio.cacheDirName` setting that
 * overrides it is wired in M5. Kept under the document folder so it sits inside
 * the preview's localResourceRoots and the relative <audio src> resolves.
 */
const CACHE_DIR_NAME = '.vscode-md-video-cache';

/** Coalesce a burst of extraction completions into a single preview refresh. */
const REFRESH_DEBOUNCE_MS = 300;

export interface ExtractionDriver {
  /** The resolver to pass as VideoAudioOptions.resolveAudio. */
  readonly resolveAudio: AudioResolver;
  /** Cancel any pending preview refresh. Call on extension deactivate. */
  dispose(): void;
}

interface DocumentEnv {
  // markdown-language-features sets this to the previewed document's Uri for a
  // file render; absent for a bare string render (where we cannot locate files).
  currentDocument?: vscode.Uri;
}

function stripQueryAndHash(src: string): string {
  return src.split(/[?#]/, 1)[0] ?? '';
}

/** Whether `p` exists and is a symlink (does not follow it). False on any error. */
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether `p` resolves to a regular file (not a dir / fifo). False on any error. */
function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Whether `err` is an expected "file is missing / not a directory" fs error. */
function isMissingFileError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Build the driver. Owns the per-target extraction state (keyed by cache path,
 * so editing a video — which changes its content-addressed cache path — retries
 * from scratch) and the debounced refresh timer.
 */
export function createExtractionDriver(): ExtractionDriver {
  // Remembers terminal-negative outcomes so a cache miss does not re-kick ffmpeg
  // on every render. See playbackDecision.ts for why this is required.
  const extractionState = new Map<string, ExtractionState>();
  let refreshTimer: NodeJS.Timeout | undefined;
  // Set on dispose(). An extraction kicked before deactivate can still settle
  // afterwards; its `.finally(scheduleRefresh)` must NOT then schedule a refresh
  // or fire `markdown.preview.refresh` post-deactivate (unref only frees the
  // event loop, it does not cancel the callback). This flag short-circuits it.
  let disposed = false;

  const scheduleRefresh = (): void => {
    // Leading-window coalesce: the first completion schedules one refresh; later
    // completions within the window ride along on it.
    if (disposed || refreshTimer) {
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      // The debounce window can elapse across a dispose(); don't fire the refresh
      // post-deactivate.
      if (disposed) {
        return;
      }
      // executeCommand can reject (shutdown / no preview open) — an unhandled
      // rejection would surface as an error — and can also throw synchronously
      // during shutdown; swallow both, there is nothing to refresh in that case.
      try {
        Promise.resolve(vscode.commands.executeCommand('markdown.preview.refresh')).then(undefined, () => {});
      } catch {
        /* shutting down or command unavailable — nothing to refresh */
      }
    }, REFRESH_DEBOUNCE_MS);
    // Never let a pending refresh keep the host's event loop alive on its own.
    refreshTimer.unref();
  };

  const startExtraction = (videoPath: string, cacheDir: string, cachePath: string): void => {
    extractionState.set(cachePath, 'extracting');
    findFfmpeg()
      .then((ffmpeg) => {
        if (!ffmpeg) {
          extractionState.set(cachePath, 'ffmpeg-not-found');
          return undefined;
        }
        return extractAudio(ffmpeg, videoPath, cacheDir).then(() => {
          // The cache file now exists; drop the remembered state so a later
          // cache deletion re-kicks instead of staying stuck on 'extracting'.
          extractionState.delete(cachePath);
        });
      })
      .catch((err: unknown) => {
        const noAudio = typeof err === 'object' && err !== null && (err as { noAudio?: boolean }).noAudio === true;
        extractionState.set(cachePath, noAudio ? 'no-audio' : 'error');
      })
      .finally(scheduleRefresh);
  };

  // M0 sibling assumption (clip.mp4 -> clip.mp3, assumed ready) — the fallback
  // when extraction cannot apply (untrusted workspace, no document Uri, non-file
  // scheme, or a video that fails path validation / does not exist on disk).
  const sibling = (videoSrc: string): AudioResolution => ({ audioSrc: audioSrcFor(videoSrc), status: 'ready' });

  const resolveViaExtraction = (videoSrc: string, rawEnv: unknown): AudioResolution | undefined => {
    // After dispose() we no longer own a refresh path, so a freshly kicked
    // extraction would settle with no way to re-render. Stop kicking and fall
    // back to the sibling assumption.
    if (disposed || !vscode.workspace.isTrusted) {
      return undefined;
    }

    const docUri = (rawEnv as DocumentEnv | undefined)?.currentDocument;
    if (!docUri || docUri.scheme !== 'file') {
      return undefined;
    }

    // S4: only extract for a document that lives inside a workspace folder. The
    // cache directory we create then sits within the workspace — the preview's
    // localResourceRoots — and we never write next to an arbitrary standalone
    // file the user merely opened outside any folder.
    const folder = vscode.workspace.getWorkspaceFolder(docUri);
    if (!folder) {
      return undefined;
    }

    try {
      const root = folder.uri.fsPath;
      const docDir = path.dirname(docUri.fsPath);
      const requested = path.resolve(docDir, stripQueryAndHash(videoSrc));

      // F4 + S2 (TOCTOU): canonicalize the requested path (resolving symlinks /
      // case / short-name aliases) and confirm the REAL target stays within the
      // workspace root, then feed that canonical path to every downstream fs and
      // spawn op. Passing the resolved path to ffmpeg means a symlink cannot be
      // swapped to point outside between this check and ffmpeg opening the file.
      // realpathSync throws when the file is absent -> caught -> sibling fallback.
      const videoPath = fs.realpathSync(requested);
      if (!isPathWithinRoots(videoPath, [root]) || !isRegularFile(videoPath)) {
        return undefined;
      }

      // A: the extractor WRITES under cacheDir, so the write target gets the same
      // canonical + boundary discipline videoPath gets for the read above —
      // previously only the read path was validated. docDir holds the document so
      // it exists; canonicalize it (a symlinked document folder must not redirect
      // the cache outside the workspace) and confirm the cache dir stays within
      // root before we ever mkdir/write there.
      const cacheDir = path.join(fs.realpathSync(docDir), CACHE_DIR_NAME);
      // S3: also refuse a cacheDir that is itself a pre-existing symlink — the
      // boundary check above canonicalizes the parent, this catches the leaf.
      if (!isPathWithinRoots(cacheDir, [root]) || isSymlink(cacheDir)) {
        return undefined;
      }

      const cachePath = cachePathFor(videoPath, cacheDir);
      // B: a cache path that exists only as a symlink is anomalous — we only ever
      // rename a real regular file into place. Don't serve it (it could redirect
      // the read outside the workspace) and don't loop re-kicking extraction (the
      // engine would no-op on its existsSync); fall back to the sibling instead.
      if (isSymlink(cachePath)) {
        return undefined;
      }
      const cacheExists = isRegularFile(cachePath);
      // H: a present cache file is authoritative, so forget any stale terminal
      // state (e.g. a past error/no-audio) for it — otherwise, were the file later
      // deleted, that stale state would resurface and block a fresh re-kick.
      if (cacheExists) {
        extractionState.delete(cachePath);
      }
      const { status, kick } = decidePlayback(cacheExists, extractionState.get(cachePath));
      if (kick) {
        startExtraction(videoPath, cacheDir, cachePath);
      }

      // Only a ready status carries a loadable src; everything else stays srcless
      // (the transform emits no src attribute, the webview shows a status badge).
      const audioSrc = status === 'ready' ? `${CACHE_DIR_NAME}/${path.basename(cachePath)}` : '';
      return { audioSrc, status };
    } catch (err) {
      // realpathSync/statSync throwing for a missing file or a race legitimately
      // falls back to the M0 sibling. Surface anything else (an actual bug or an
      // unexpected env shape) so it isn't silently masked as a sibling render —
      // the user still gets the fallback, but the failure leaves a trace.
      if (!isMissingFileError(err)) {
        console.error('[markdown-video-audio] unexpected audio-resolve failure', err);
      }
      return undefined;
    }
  };

  const resolveAudio: AudioResolver = (videoSrc, rawEnv) => resolveViaExtraction(videoSrc, rawEnv) ?? sibling(videoSrc);

  return {
    resolveAudio,
    dispose(): void {
      disposed = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
    },
  };
}
