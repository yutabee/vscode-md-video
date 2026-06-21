# Markdown Video Audio

[![CI](https://github.com/yutabee/vscode-md-video/actions/workflows/ci.yml/badge.svg)](https://github.com/yutabee/vscode-md-video/actions/workflows/ci.yml)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/yutabee.markdown-video-audio.svg)](https://marketplace.visualstudio.com/items?itemName=yutabee.markdown-video-audio)
[![Open VSX](https://img.shields.io/open-vsx/v/yutabee/markdown-video-audio?label=Open%20VSX)](https://open-vsx.org/extension/yutabee/markdown-video-audio)

Play MP4/MOV/M4V videos embedded in the VS Code **Markdown preview** — with sound.

![A clip playing with sound inside the VS Code Markdown preview](https://raw.githubusercontent.com/yutabee/vscode-md-video/main/images/demo.gif)

The VS Code webview ships no AAC decoder, so MP4/MOV/M4V videos in the Markdown
preview play silent ([microsoft/vscode#181616](https://github.com/microsoft/vscode/issues/181616),
closed as by-design). This extension rewrites those videos at render time into a
**muted `<video>` paired with a sibling `<audio>`** and keeps the two in sync, so
embedded clips actually play with sound.

## Status

Early development (v0.0.x). What works today:

- Render-time rewrite of local `<video src="…">` and `![](clip.mp4)` references
  (MP4/MOV/M4V) into a muted-video + sibling-audio player.
- Play / pause / seek / playback-rate sync with drift correction between the
  video and its audio, in the built-in Markdown preview.
- **Automatic audio extraction with ffmpeg.** On first preview the player shows a
  "Preparing audio" badge while ffmpeg extracts the track to a workspace cache;
  the preview refreshes itself once it finishes and the clip plays — no sibling
  file to place by hand. See [Automatic extraction](#automatic-extraction).

## Usage

Reference a local video in any Markdown file, using either raw HTML or image
syntax:

```markdown
<video src="clip.mp4" controls></video>

![](clip2.mp4)
```

Open the Markdown preview (`Ctrl+Shift+V` / `⇧⌘V`). Each MP4/MOV/M4V becomes a player
whose audio plays from the sibling track while the video stays muted. WebM videos
are left untouched — the webview decodes their audio natively.

## Automatic extraction

When you open the preview in a **trusted workspace** with `ffmpeg` on `PATH`, the
extension extracts each video's audio automatically into a
`.vscode-md-video-cache/` folder next to the Markdown file (inside the workspace,
so the preview is allowed to load it). The first render shows a status badge while
ffmpeg runs; when it settles the preview refreshes and the clip plays. The cache
is content-addressed, so editing a video re-extracts.

Extraction is skipped — and the extension falls back to a **sibling audio file**
(`clip.mp4` → `clip.mp3` placed next to the video) — when it cannot apply: an
untrusted workspace, a Markdown file opened outside any workspace folder, ffmpeg
not found, or a video with no audio track. The status badge reports which case
applies (`No audio`, `ffmpeg not found`, `Audio error`).

## How it works

- `extendMarkdownIt` rewrites local `<video>` tags and `![](…)` MP4/MOV/M4V image
  references during render, emitting a muted `<video>`, a sibling `<audio>`, and
  `data-*` status attributes.
- The preview script (`markdown.previewScripts`) reads those attributes and keeps
  the hidden `<audio>` in sync with the muted `<video>`.

Communication is one-way: the extension host embeds everything the preview needs
at render time; the preview script never messages back (the built-in preview is
not an extension-owned webview).

## Requirements

- VS Code 1.90 or newer.
- ffmpeg on `PATH` for automatic extraction. Without it the extension falls back
  to a manually placed sibling audio file (see
  [Automatic extraction](#automatic-extraction)). A configurable ffmpeg path is
  planned (see [Settings](#settings)).

## Settings

| Setting | Default | Status | Description |
|---|---|---|---|
| `markdownVideoAudio.enabled` | `true` | active | Enable the video/audio rewrite in the Markdown preview. |
| `markdownVideoAudio.ffmpegPath` | `""` | reserved | Path to ffmpeg for extraction. Empty = search `PATH`. The override is not wired yet; extraction currently always searches `PATH`. |
| `markdownVideoAudio.autoplay` | `false` | reserved | Autoplay (muted) when the preview opens (planned). |
| `markdownVideoAudio.maxSyncDriftMs` | `250` | reserved | Target max audio/video drift before correction. Currently fixed at 250 ms. |
| `markdownVideoAudio.cacheDirName` | `.vscode-md-video-cache` | reserved | Folder for the extracted-audio cache. The override is not wired yet; the cache dir name is currently fixed. |

_reserved_ settings are declared for upcoming milestones and have no effect yet.

## Develop / try it locally

```bash
git clone https://github.com/yutabee/vscode-md-video.git
cd vscode-md-video
npm install
npm run build
```

Press <kbd>F5</kbd> to launch an Extension Development Host, then open
`test/fixtures/spike.md` and its Markdown preview. With `ffmpeg` on `PATH` and the
workspace trusted, the audio extracts automatically — see [SPIKE.md](./SPIKE.md)
for the manual check (and the sibling-file fallback).

| Script | What it does |
|---|---|
| `npm run build` | Compile the extension (`tsc`) and bundle the preview script (`esbuild`). |
| `npm run watch` | Recompile the extension on change. |
| `npm test` | Run the transform unit tests (`node:test`). |
| `npm run lint` | Lint the sources and tests. |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## License

[MIT](./LICENSE.md) © yutabee
