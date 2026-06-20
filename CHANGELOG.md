# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- M0 spike: render-time rewrite of local MP4/MOV references — both
  `<video src="…">` raw HTML and `![](clip.mp4)` image syntax — into a muted
  `<video>` paired with a sibling `<audio>` in the built-in Markdown preview.
- Preview script that syncs play / pause / seek / playback-rate and corrects
  drift between the muted video and its sibling audio.
- Settings scaffold: `enabled` (active); `ffmpegPath`, `autoplay`,
  `maxSyncDriftMs`, `cacheDirName` (reserved for upcoming milestones).
- Extension icon for the Marketplace listing.

### Known limitations

- Automatic ffmpeg audio extraction is not implemented yet; a sibling audio file
  (e.g. `clip.mp3` next to `clip.mp4`) must be placed by hand.

[Unreleased]: https://github.com/yutabee/vscode-md-video/commits/main
