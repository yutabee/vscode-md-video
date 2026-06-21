# Feasibility Spike

## M4 Auto-Extraction Check (current)

ffmpeg now extracts the audio automatically — no sibling `.mp3` needs to be placed by hand.

1. Have `ffmpeg` on `PATH` (or one of the common install dirs the engine probes).
2. Place only the videos under `test/fixtures/`: `clip.mp4`, `clip2.mp4` (each with an audio track).
3. Run the extension in an Extension Development Host with F5.
4. Open `test/fixtures/spike.md`, **trust the workspace** when prompted, and open the Markdown preview.
5. On first open the players show a "Preparing audio" badge while ffmpeg extracts. The preview
   refreshes itself once extraction settles (no manual reload).
6. After the refresh, press play and confirm audio plays while the video stays muted.
7. Confirm a `.vscode-md-video-cache/` directory appeared next to `spike.md` holding `mdva-audio-*.mp3`.

Status badges to expect instead of audio: "No audio" (video has no audio track), "ffmpeg not found"
(no usable ffmpeg), "Audio error" (extraction failed). In an **untrusted** workspace, or for a `.md`
opened outside a `file://` scheme, extraction is skipped and the M0 sibling assumption (below) applies.

`markdown.preview.allowInsecureLocalContent` is not required. The built-in Markdown preview resolves
relative media paths (the video and the cache-dir audio) to preview resources.

## M0 Sibling Fallback

When auto-extraction does not apply (untrusted workspace / no on-disk document), the transform falls
back to the original M0 behavior: it pairs each video with a sibling `.mp3` of the same base name
(`clip.mp4` → `clip.mp3`) and assumes that file already exists next to the video.
