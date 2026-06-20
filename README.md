# Markdown Video Audio

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

Not yet implemented: **automatic audio extraction.** Until then you place the
sibling audio file yourself — see [Current limitation](#current-limitation).
ffmpeg-based extraction and the settings that depend on it are planned (see
[Settings](#settings)).

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

## Current limitation

Automatic extraction is not built yet, so the audio file must already exist next
to the video: for `clip.mp4`, place `clip.mp3` in the same folder. The audio must
live inside the workspace so the preview is allowed to load it. Once ffmpeg
extraction lands, this manual step goes away.

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
- ffmpeg — _planned._ Once automatic extraction lands it must be on `PATH` or set
  via `markdownVideoAudio.ffmpegPath`. It is not used yet.

## Settings

| Setting | Default | Status | Description |
|---|---|---|---|
| `markdownVideoAudio.enabled` | `true` | active | Enable the video/audio rewrite in the Markdown preview. |
| `markdownVideoAudio.ffmpegPath` | `""` | reserved | Path to ffmpeg for automatic extraction (planned). Empty = search `PATH`. |
| `markdownVideoAudio.autoplay` | `false` | reserved | Autoplay (muted) when the preview opens (planned). |
| `markdownVideoAudio.maxSyncDriftMs` | `250` | reserved | Target max audio/video drift before correction. Currently fixed at 250 ms. |
| `markdownVideoAudio.cacheDirName` | `.vscode-md-video-cache` | reserved | Folder for the extracted-audio cache (planned). |

_reserved_ settings are declared for upcoming milestones and have no effect yet.

## Develop / try it locally

```bash
git clone https://github.com/yutabee/vscode-md-video.git
cd vscode-md-video
npm install
npm run build
```

Press <kbd>F5</kbd> to launch an Extension Development Host, then open
`test/fixtures/spike.md` and its Markdown preview. The fixture needs sibling
audio files placed by hand — see [SPIKE.md](./SPIKE.md) for the manual check.

| Script | What it does |
|---|---|
| `npm run build` | Compile the extension (`tsc`) and bundle the preview script (`esbuild`). |
| `npm run watch` | Recompile the extension on change. |
| `npm test` | Run the transform unit tests (`node:test`). |
| `npm run lint` | Lint the sources and tests. |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## License

[MIT](./LICENSE.md) © yutabee
