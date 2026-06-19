# Security Policy

## Supported versions

This project is in early development (0.0.x). Only the latest released version
receives security fixes.

| Version       | Supported |
| ------------- | --------- |
| latest 0.0.x  | ✅        |
| older         | ❌        |

## Reporting a vulnerability

Please report security issues privately — do **not** open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/yutabee/vscode-md-video/security/advisories/new)
("Report a vulnerability" on the repository's **Security** tab). Include the
affected version, reproduction steps, and impact. You can expect an initial
response within a few days.

## Scope notes

The extension resolves local media paths and, in upcoming milestones, will run
ffmpeg as a subprocess and write an audio cache inside the workspace. Reports
about path handling, the planned subprocess invocation, or workspace-trust
gating are in scope.
