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

## Releasing (maintainers)

Publishing is automated by
[`.github/workflows/release.yml`](./.github/workflows/release.yml), which runs
when a `v*` tag is pushed.

One-time setup — add repository secrets (Settings → Secrets and variables →
Actions):

- `VSCE_PAT` — Azure DevOps PAT with the **Marketplace → Manage** scope, for the
  VS Code Marketplace. The publisher must already exist at
  <https://marketplace.visualstudio.com/manage>.
- `OVSX_PAT` — Open VSX token (optional; the Open VSX step is skipped if unset).

To cut a release:

1. Bump `version` in `package.json` and move the `CHANGELOG.md` entries from
   `## [Unreleased]` into a new version section.
2. Commit, open a PR, and merge to `main`.
3. Tag the merge commit and push the tag:

   ```bash
   git tag v0.0.1
   git push origin v0.0.1
   ```

The workflow then verifies the tag matches `package.json`, packages the VSIX,
publishes to the Marketplace (and Open VSX when configured), and attaches the
VSIX to a GitHub Release.

### Open VSX

To also publish to [Open VSX](https://open-vsx.org), sign in there, sign the
Eclipse Foundation Publisher Agreement, claim the `yutabee` namespace, create an
access token, and add it as the `OVSX_PAT` repository secret. New tags then
publish to Open VSX automatically. To backfill a tag released before the secret
existed, run the **Publish to Open VSX** workflow manually (Actions → run
workflow → enter the tag).

## Architecture in one minute

- `src/transform.ts` — render-time markdown-it transform: classifies video
  references and rewrites local MP4/MOV into a muted `<video>` + sibling
  `<audio>` player block.
- `src/extension.ts` — extension entry; wires the transform into the Markdown
  preview via `extendMarkdownIt`.
- `src/webview/inject.ts` — preview-side script (bundled by esbuild) that syncs
  the audio to the muted video. Communication is one-way: the host embeds
  everything the preview needs via `data-*` attributes at render time.
