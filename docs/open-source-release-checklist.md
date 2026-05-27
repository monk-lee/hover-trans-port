# Open Source Release Checklist

This checklist is for the first public source release.

## Repository

- [ ] Create/confirm GitHub repo `monk-lee/hover-trans-port`.
- [ ] Set visibility to public only after checklist passes.
- [ ] Set description: `Chrome MV3 extension for explicit hover/selection translation through a local AI CLI native host.`
- [ ] Add topics: chrome-extension, manifest-v3, native-messaging, translation, codex-cli, local-first.
- [ ] Enable Issues.
- [ ] Enable Discussions only if maintainers are ready to respond.
- [ ] Enable private vulnerability reporting.
- [ ] Enable secret scanning.
- [ ] Protect `main` after first public push.

## Required Files

- [ ] LICENSE
- [ ] README.md
- [ ] PRIVACY.md
- [ ] SECURITY.md
- [ ] CONTRIBUTING.md
- [ ] CODE_OF_CONDUCT.md
- [ ] .github/ISSUE_TEMPLATE/bug_report.yml
- [ ] .github/ISSUE_TEMPLATE/feature_request.yml
- [ ] .github/PULL_REQUEST_TEMPLATE.md
- [ ] docs/native-host-install.md

## Verification

- [ ] pnpm install
- [ ] pnpm verify
- [ ] pnpm macos:script-installer:test
- [ ] pnpm macos:script-installer:build
- [ ] Release uploads `install-macos-native-host.sh`, `checksums.txt`, and architecture-specific helper files as individual assets so `curl .../latest/download/install-macos-native-host.sh | bash` works.
- [ ] Release also includes `hover-trans-port-native-host-macos-0.2.14.tar.gz` for inspect-first/offline installation.
- [ ] pnpm native:uninstall
- [ ] Reload the extension and confirm `Check Native Host` returns `Native Host is not installed or not reachable.`
- [ ] pnpm build
- [ ] pnpm native:install
- [ ] Script installer `install` creates `~/Library/Application Support/HoverTransPort/current`.
- [ ] Script installer `status` reports installed native host version.
- [ ] Script installer `update` switches `current` to the new version and keeps the previous version directory.
- [ ] Script installer `uninstall` removes the Chrome manifest and install root.
- [ ] Load dist/ from chrome://extensions
- [ ] Options Diagnostics / Check Native Host succeeds
- [ ] Options Diagnostics / Check Native Host shows host version, bridge version, and protocol version.
- [ ] Native Host update-required state blocks translation before provider execution when protocol is too old.
- [ ] `~/Library/Application Support/HoverTransPort/current` points at the expected versioned host directory after install.
- [ ] Options Translation Provider / Check Provider succeeds
- [ ] Selection translation succeeds
- [ ] Hover block translation succeeds
- [ ] Cache clear succeeds
- [ ] `git status --short` returns no output.
- [ ] Run `rg -n "\bsk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|/Users/[A-Za-z0-9._-]+|session token|oauth token" .` and confirm matches are limited to intentional documentation warnings.

## Release

- [ ] Tag v0.2.14
- [ ] Release title: v0.2.14
- [ ] Release notes mention macOS + Chrome + Codex CLI, Claude CLI, Gemini CLI, OpenCode CLI, and Antigravity CLI support
- [ ] Release notes link docs/native-host-install.md
- [ ] Release notes link PRIVACY.md
- [ ] Release notes state this is not a Chrome Web Store release

## Publication Gates

- [ ] Confirm no secret, token, private path, or private account identifier appears in committed files.
- [ ] Confirm `pnpm verify` passes.
- [ ] Confirm native host install/uninstall works on maintainer macOS.
- [ ] Confirm README does not imply offline-only translation.
- [ ] Confirm README does not imply official affiliation with OpenAI, Codex, Anthropic, Claude, Google, Gemini, OpenCode, or Antigravity.
- [ ] Confirm privacy docs disclose that Codex CLI, Claude CLI, Gemini CLI, OpenCode CLI, and Antigravity CLI may send requested text upstream according to each CLI provider's account and policies.
- [ ] Confirm SECURITY.md documents the private vulnerability reporting channel.
- [x] Add a README screenshot or short GIF of inline translation before broad public announcement.
