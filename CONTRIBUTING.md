# Contributing

Thanks for your interest in improving Markdown Video Audio.

## Prerequisites

- Node.js (current LTS or newer) and npm.
- VS Code 1.90 or newer.

## Setup

```bash
git clone https://github.com/yutabee/vscode-md-video.git
cd vscode-md-video
npm install
npm run build
```

## Run the extension

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host (the
"Run Extension" config builds first). Open `test/fixtures/spike.md`, place the
sibling audio files described in [SPIKE.md](./SPIKE.md), and open the Markdown
preview.

## Checks

Run these before opening a pull request — CI runs the same:

```bash
npm run build   # tsc + esbuild
npm run lint    # eslint
npm test        # node:test transform unit tests
```

## Commit and PR conventions

- One change per branch: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `ci/…`.
- Keep commits small and focused; each should build and test green.
- Use [Conventional Commit](https://www.conventionalcommits.org/) messages
  (e.g. `fix(transform): …`).
- Update [CHANGELOG.md](./CHANGELOG.md) under `## [Unreleased]` for user-facing
  changes.
- Open the pull request against `main`; CI must pass before merge.

## Architecture in one minute

- `src/transform.ts` — render-time markdown-it transform: classifies video
  references and rewrites local MP4/MOV into a muted `<video>` + sibling
  `<audio>` player block.
- `src/extension.ts` — extension entry; wires the transform into the Markdown
  preview via `extendMarkdownIt`.
- `src/webview/inject.ts` — preview-side script (bundled by esbuild) that syncs
  the audio to the muted video. Communication is one-way: the host embeds
  everything the preview needs via `data-*` attributes at render time.
