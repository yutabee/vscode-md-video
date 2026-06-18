# M0 Feasibility Spike

## Manual F5 Check

1. Place these files by hand under `test/fixtures/`:
   - `clip.mp4`
   - `clip.mp3`
   - `clip2.mp4`
   - `clip2.mp3`
2. Run the extension in an Extension Development Host with F5.
3. Open `test/fixtures/spike.md` in the Extension Development Host.
4. Open the Markdown preview.
5. Confirm both embedded videos render as Markdown Video Audio players.
6. Press play and confirm audio comes from the sibling `.mp3` while the video plays muted.

The M0 spike does not generate audio files. It assumes the sibling `.mp3` files already exist next to the videos. ffmpeg extraction is M2 scope.

`markdown.preview.allowInsecureLocalContent` is not required. The built-in Markdown preview resolves relative media paths to preview resources.
