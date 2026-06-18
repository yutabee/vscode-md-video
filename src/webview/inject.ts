// Preview-side script, bundled to dist/preview/inject.js and loaded via
// contributes.markdown.previewScripts. Runs inside the built-in Markdown
// preview webview DOM. One-way only: it reads data-* attributes the extension
// host embedded at render time and binds audio/video sync. It cannot message
// the extension host back.

import './inject.css';

const maxSyncDriftMs = 250;

interface VideoAudioBinding {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  dispose(): void;
}

const statusLabels: Record<string, string> = {
  preparing: 'Preparing audio',
  'no-audio': 'No audio',
  'ffmpeg-not-found': 'ffmpeg not found',
  error: 'Audio error',
};

function syncCurrentTime(video: HTMLVideoElement, audio: HTMLAudioElement): void {
  if (Math.abs(audio.currentTime - video.currentTime) > maxSyncDriftMs / 1000) {
    audio.currentTime = video.currentTime;
  }
}

function showError(player: HTMLElement, message: string, error?: Event): void {
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

  player.dataset.mdvaBound = '1';
  ensureStatusBadge(player);

  const syncAndPlay = (): void => {
    syncCurrentTime(video, audio);
    audio.play().catch((error: unknown) => {
      showError(player, 'Audio playback failed. Check that the sibling audio file can be loaded.', error instanceof Event ? error : undefined);
      console.error('[markdown-video-audio] audio.play() rejected', error);
    });
  };

  const pauseAudio = (): void => {
    audio.pause();
  };

  const seekAudio = (): void => {
    audio.currentTime = video.currentTime;
  };

  const correctDrift = (): void => {
    syncCurrentTime(video, audio);
  };

  const updateRate = (): void => {
    audio.playbackRate = video.playbackRate;
  };

  const reportAudioError = (event: Event): void => {
    showError(player, 'Audio failed to load. Check that the sibling audio file exists next to the video.', event);
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
      audio.removeEventListener('error', reportAudioError);
      video.removeEventListener('error', reportVideoError);
      delete player.dataset.mdvaBound;
    },
  };
}

function bindAll(root: ParentNode): VideoAudioBinding[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-mdva="1"]'))
    .map(bindPlayer)
    .filter((binding): binding is VideoAudioBinding => binding !== undefined);
}

// The built-in preview re-renders the body on edit; bind idempotently.
window.addEventListener('vscode.markdown.updateContent', () => {
  bindAll(document.body);
});

bindAll(document.body);
