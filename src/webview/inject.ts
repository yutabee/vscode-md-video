// Preview-side script, bundled to dist/preview/inject.js and loaded via
// contributes.markdown.previewScripts. Runs inside the built-in Markdown
// preview webview DOM. One-way only: it reads data-* attributes the extension
// host embedded at render time and binds audio/video sync. It cannot message
// the extension host back.

import './inject.css';
import { DEFAULT_DRIFT_TUNING, canResumeAudio, driftAction, isBenignPlayError, shouldCorrectDrift } from './sync';

interface VideoAudioBinding {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  dispose(): void;
}

const bindings = new Map<HTMLElement, VideoAudioBinding>();

const statusLabels: Record<string, string> = {
  preparing: 'Preparing audio',
  'no-audio': 'No audio',
  'ffmpeg-not-found': 'ffmpeg not found',
  error: 'Audio error',
};

function errorName(error: unknown): string | undefined {
  if (error instanceof DOMException) {
    return error.name;
  }

  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = error.name;
    return typeof name === 'string' ? name : undefined;
  }

  return undefined;
}

// Discrete-event hard-align: snap audio to the video clock when the two have
// drifted past the soft band (used when resuming play, before continuous
// nudging takes over). A deliberate seek aligns unconditionally — see seekAudio.
function alignAudio(video: HTMLVideoElement, audio: HTMLAudioElement): void {
  if (Math.abs(audio.currentTime - video.currentTime) > DEFAULT_DRIFT_TUNING.soft) {
    audio.currentTime = video.currentTime;
  }
}

function showError(player: HTMLElement, message: string, error?: unknown): void {
  player.dataset.mdvaStatus = 'error';
  let errorEl = player.querySelector<HTMLElement>('.mdva-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'mdva-error';
    player.append(errorEl);
  }

  errorEl.textContent = message;
  console.error(`[markdown-video-audio] ${message}`, error);
}

function ensureStatusBadge(player: HTMLElement): void {
  const status = player.dataset.mdvaStatus ?? 'ready';
  let badge = player.querySelector<HTMLElement>('.mdva-status');

  if (status === 'ready') {
    badge?.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'mdva-status';
    player.append(badge);
  }

  badge.textContent = statusLabels[status] ?? status;
}

function bindPlayer(player: HTMLElement): VideoAudioBinding | undefined {
  if (player.dataset.mdvaBound === '1') {
    return undefined;
  }

  const video = player.querySelector<HTMLVideoElement>('video.mdva-video');
  const audio = player.querySelector<HTMLAudioElement>('audio.mdva-audio');
  if (!video || !audio) {
    showError(player, 'Markdown Video Audio player is missing a video or audio element.');
    return undefined;
  }

  ensureStatusBadge(player);

  // Only a ready player carries a loadable <audio src>. For preparing / no-audio
  // / ffmpeg-not-found / error, show the status badge but do NOT wire sync or
  // mark the player bound: the host kicks ffmpeg on a miss and, once it settles,
  // refreshes the preview to re-render with status=ready — leaving the player
  // unbound here lets that later pass bind it (whether the preview patches the
  // element in place or replaces it).
  const status = player.dataset.mdvaStatus ?? 'ready';
  if (status !== 'ready') {
    return undefined;
  }

  player.dataset.mdvaBound = '1';

  let autoplayRetryArmed = false;
  let autoplayRetryUsed = false;

  const retryAutoplay = (): void => {
    disarmAutoplayRetry();
    if (!video.paused && !video.ended) {
      syncAndPlay();
    }
  };

  const disarmAutoplayRetry = (): void => {
    if (!autoplayRetryArmed) {
      return;
    }

    autoplayRetryArmed = false;
    video.removeEventListener('play', retryAutoplay);
    document.removeEventListener('pointerdown', retryAutoplay);
  };

  const armAutoplayRetry = (): void => {
    if (autoplayRetryArmed || autoplayRetryUsed) {
      return;
    }

    autoplayRetryArmed = true;
    autoplayRetryUsed = true;
    video.addEventListener('play', retryAutoplay, { once: true });
    document.addEventListener('pointerdown', retryAutoplay, { once: true });
  };

  const handlePlayRejected = (error: unknown): void => {
    const name = errorName(error) ?? '';
    if (name === 'NotAllowedError') {
      armAutoplayRetry();
      return;
    }

    if (isBenignPlayError(name)) {
      return;
    }

    showError(player, 'Audio playback failed. The audio track could not be played.', error);
  };

  const syncAndPlay = (): void => {
    alignAudio(video, audio);
    // Defer until the audio has buffered enough: play() on an unbuffered or
    // mid-seek element tends to stall or reject and then re-drift on recovery.
    // The 'canplay' handler resumes once it settles.
    if (!canResumeAudio(audio.readyState, audio.seeking)) {
      return;
    }

    audio.play().catch(handlePlayRejected);
  };

  const pauseAudio = (): void => {
    disarmAutoplayRetry();
    audio.pause();
  };

  const seekAudio = (): void => {
    // A seek is a deliberate jump: align exactly, then let timeupdate re-nudge.
    audio.currentTime = video.currentTime;
  };

  const correctDrift = (): void => {
    // Continuous correction: nudge audio.playbackRate for small drift, hard-seek
    // only when too far apart. Never hard-set currentTime every frame (that
    // flushes the decode buffer and causes audible dropouts) — see sync.ts.
    // Skip while paused or mid-seek so we don't re-seek a deferred/seeking audio
    // element and stall its readiness recovery (the 'canplay'/'seeked' handlers
    // resume it instead).
    if (!shouldCorrectDrift(audio.paused, video.paused, audio.seeking, video.seeking)) {
      return;
    }

    const baseRate = video.playbackRate;
    const action = driftAction(audio.currentTime, video.currentTime, baseRate);
    switch (action.kind) {
      case 'rate':
        audio.playbackRate = action.playbackRate;
        break;
      case 'seek':
        audio.currentTime = action.to;
        if (audio.playbackRate !== baseRate) {
          audio.playbackRate = baseRate;
        }
        break;
      case 'none':
        if (audio.playbackRate !== baseRate) {
          audio.playbackRate = baseRate;
        }
        break;
    }
  };

  const resumeWhenAudioReady = (): void => {
    if (!video.paused && !video.ended) {
      syncAndPlay();
    }
  };

  const updateRate = (): void => {
    // User changed speed: reset audio to the base rate; correctDrift re-nudges.
    audio.playbackRate = video.playbackRate;
  };

  const reportAudioError = (event: Event): void => {
    showError(player, 'Audio failed to load. The audio track could not be loaded.', event);
  };

  const reportVideoError = (event: Event): void => {
    showError(player, 'Video failed to load in the Markdown preview.', event);
  };

  video.addEventListener('play', syncAndPlay);
  video.addEventListener('pause', pauseAudio);
  video.addEventListener('ended', pauseAudio);
  video.addEventListener('seeking', seekAudio);
  video.addEventListener('timeupdate', correctDrift);
  video.addEventListener('ratechange', updateRate);
  // Resume after the audio settles. 'canplay' covers cold buffering; 'seeked'
  // covers an align/seek that completed while already buffered (where 'canplay'
  // does not re-fire) — without it a deferred play strands the audio silent;
  // 'playing' covers stall recovery.
  audio.addEventListener('canplay', resumeWhenAudioReady);
  audio.addEventListener('seeked', resumeWhenAudioReady);
  audio.addEventListener('playing', resumeWhenAudioReady);
  audio.addEventListener('error', reportAudioError);
  video.addEventListener('error', reportVideoError);
  updateRate();

  return {
    video,
    audio,
    dispose(): void {
      video.removeEventListener('play', syncAndPlay);
      video.removeEventListener('pause', pauseAudio);
      video.removeEventListener('ended', pauseAudio);
      video.removeEventListener('seeking', seekAudio);
      video.removeEventListener('timeupdate', correctDrift);
      video.removeEventListener('ratechange', updateRate);
      disarmAutoplayRetry();
      audio.removeEventListener('canplay', resumeWhenAudioReady);
      audio.removeEventListener('seeked', resumeWhenAudioReady);
      audio.removeEventListener('playing', resumeWhenAudioReady);
      audio.removeEventListener('error', reportAudioError);
      video.removeEventListener('error', reportVideoError);
      delete player.dataset.mdvaBound;
    },
  };
}

// A binding is stale when the player wrapper survived a re-render but no longer
// matches what we wired. The built-in preview patches the DOM in place: the same
// wrapper can keep its identity while its status flips back (ready -> preparing
// when the host re-kicks extraction after the video is edited) or its inner
// <video>/<audio> elements are replaced with fresh instances. Such a binding
// points at detached elements / a now-srcless audio and must be torn down and
// re-evaluated, not kept alive just because the wrapper is still connected.
function isBindingStale(player: HTMLElement, binding: VideoAudioBinding): boolean {
  return (
    (player.dataset.mdvaStatus ?? 'ready') !== 'ready' ||
    player.querySelector<HTMLVideoElement>('video.mdva-video') !== binding.video ||
    player.querySelector<HTMLAudioElement>('audio.mdva-audio') !== binding.audio
  );
}

function bindAll(root: ParentNode): void {
  for (const [player, binding] of bindings) {
    if (!player.isConnected || isBindingStale(player, binding)) {
      binding.dispose();
      bindings.delete(player);
    }
  }

  for (const player of root.querySelectorAll<HTMLElement>('[data-mdva="1"]')) {
    if (bindings.has(player)) {
      continue;
    }

    const binding = bindPlayer(player);
    if (binding) {
      bindings.set(player, binding);
    }
  }
}

// The built-in preview re-renders the body on edit; bind idempotently.
window.addEventListener('vscode.markdown.updateContent', () => {
  bindAll(document.body);
});

bindAll(document.body);
