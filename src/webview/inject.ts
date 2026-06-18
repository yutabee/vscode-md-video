// Preview-side script, bundled to dist/preview/inject.js and loaded via
// contributes.markdown.previewScripts. Runs inside the built-in Markdown
// preview webview DOM. One-way only: it reads data-* attributes the extension
// host embedded at render time and binds audio/video sync. It cannot message
// the extension host back.
//
// Scaffold only — see spec M1. Currently a no-op so the bundle exists.

interface VideoAudioBinding {
  video: HTMLVideoElement;
  audio?: HTMLAudioElement;
  dispose(): void;
}

// TODO(M1): walk data-mdva="1" elements, create hidden <audio> for status=ready,
// keep it in sync with the muted <video>, correct drift > maxSyncDriftMs.
function bindAll(_root: ParentNode): VideoAudioBinding[] {
  return [];
}

// The built-in preview re-renders the body on edit; bind idempotently.
window.addEventListener('vscode.markdown.updateContent', () => {
  bindAll(document.body);
});

bindAll(document.body);
