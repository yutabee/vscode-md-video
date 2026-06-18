# Markdown Video Audio

Play MP4/MOV videos embedded in the VS Code **Markdown preview** with sound.

The VS Code webview has no AAC codec, so videos in the Markdown preview play silent
(microsoft/vscode#181616, closed as-designed). This extension extracts the audio with
ffmpeg and keeps it in sync with the muted video, so embedded videos actually play with sound.

## Status

Early development. The design is specified but not yet implemented — the first step is an
**M0 feasibility spike** verifying that a Markdown-relative `<audio>` element resolves to a
webview resource and plays under the built-in preview's default Content-Security-Policy.

See the design spec (in the planning repo) for the architecture, ADRs, and acceptance criteria.

## How it works (planned)

- `extendMarkdownIt` rewrites `<video>` tags and bare `.mp4`/`.mov` links during render,
  embedding a Markdown-relative `<audio>` source and `data-*` status attributes.
- The preview script (`markdown.previewScripts`) reads those attributes and keeps the hidden
  `<audio>` in sync with the muted `<video>`.
- Audio is extracted to a cache directory inside the workspace (so it stays within the
  preview's `localResourceRoots`).

Communication is one-way: the extension host embeds everything the preview needs at render time;
the preview script never messages back (the built-in preview is not an extension-owned webview).

## Requirements

- ffmpeg on PATH, or set `markdownVideoAudio.ffmpegPath`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownVideoAudio.enabled` | `true` | Enable audio playback for preview videos. |
| `markdownVideoAudio.ffmpegPath` | `""` | Path to ffmpeg. Empty = search PATH. |
| `markdownVideoAudio.autoplay` | `false` | Autoplay (muted) when the preview opens. |
| `markdownVideoAudio.maxSyncDriftMs` | `250` | Max audio/video drift before correction (ms). |
| `markdownVideoAudio.cacheDirName` | `.vscode-md-video-cache` | Cache dir name under the workspace. |

## License

[MIT](./LICENSE.md)
