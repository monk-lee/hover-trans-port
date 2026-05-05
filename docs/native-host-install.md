# Native Host Install

Hover Trans Port uses Chrome Native Messaging to connect the browser extension to a local compiled native helper. The helper calls local AI CLIs for requested translations.

This guide covers the current macOS developer preview:

- macOS
- Google Chrome
- Unpacked extension loaded from this repository's `dist/` folder
- Codex CLI as the default executable provider

Chrome Web Store installation is not part of this preview.

## Script Installer

The alpha non-developer macOS install path is the script installer. It installs the prebuilt native helper without Node.js, pnpm, Cargo, or Xcode.

For a one-line alpha install from GitHub Releases:

```bash
curl -fsSL https://github.com/dev-monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

The release must include these individual assets so the curl installer can fetch the right helper for the current Mac:

- `install-macos-native-host.sh`
- `checksums.txt`
- `hover-trans-port-helper-macos-arm64`
- `hover-trans-port-helper-macos-x64`, when an Intel build is available

The tarball form is also supported:

```bash
tar -xzf hover-trans-port-native-host-macos-0.1.0.tar.gz
cd hover-trans-port-native-host-macos-0.1.0
bash install-macos-native-host.sh install
```

The safer inspect-first form is:

```bash
curl -fLO https://github.com/dev-monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh
bash install-macos-native-host.sh install
```

Useful commands:

```bash
bash install-macos-native-host.sh status
bash install-macos-native-host.sh update
bash install-macos-native-host.sh uninstall
```

The installer writes the helper to `~/Library/Application Support/Hover Trans Port/native-hosts/<version>/`, updates `current`, writes the stable launcher, and registers Chrome's Native Messaging manifest.

Codex CLI is still a separate prerequisite. The installer does not store provider credentials or browser session data.

## Developer Install

From the repository root:

```bash
pnpm install
pnpm build
pnpm helper:build:release
pnpm native:install
```

The installer writes:

- A Chrome native host manifest in Chrome's user-specific Native Messaging hosts directory.
- By default, a manifest `path` that points at `native-helper/target/release/hover-trans-port-helper`.

Run `pnpm helper:build:release` before `pnpm native:install`; the installer fails with a clear message if the compiled helper is missing.

For legacy debugging only, set `HOVER_TRANS_PORT_USE_NODE_HOST=1` to install the Node native-host fallback into the versioned Application Support layout with a stable launcher.

## Diagnostics

After installing:

1. Open `chrome://extensions`.
2. Reload Hover Trans Port.
3. Open the extension Options page.
4. Click `Check Provider` in `Translation Provider`.
5. Expand `Diagnostics` and click `Check Native Host`.

Expected results: `Check Provider` shows Codex as available, and `Check Native Host` shows the bridge is connected.

## Options

Common settings:

- `Target language`: translation output language. Choose `Korean` for Korean output.
- `Timeout seconds`: per-request Codex timeout. The default is 30 seconds. Values are clamped to 5-120.
- `Use cache`: when disabled, Local Bridge skips both cache lookup and cache write.
- `Model`: Codex CLI model passed as `--model <model>`. Reset restores `gpt-5.4-mini`.

Invalid or unavailable model names fail at translation time and render the inline Codex execution error.

Diagnostics:

- `Check Native Host`: verifies Chrome can reach the native host.
- `Check Provider`: verifies configured provider CLIs are available. Codex CLI is the default provider for the current extension UI.
- `Debug logging`: writes cache/provider diagnostics to `~/.hover-trans-port/hover-trans-port.log`. The Debug Log controls can show and clear that log.

## Cache And Logs

The developer preview stores successful translations in a local SQLite database owned by the native helper: `~/.hover-trans-port/cache.sqlite`.

Cached entries include provider, selected model, target language, normalized source text, and translated text. The Options page Cache section can clear cached translations through the Native Host.

For isolated cache tests, set `HOVER_TRANS_PORT_CACHE_PATH=/tmp/hover-trans-port-cache.sqlite`.

Debug logs, when enabled, are written to `~/.hover-trans-port/hover-trans-port.log`. The Options page Debug Log controls can view and clear this file.

## Uninstall

From a script installer payload:

```bash
bash install-macos-native-host.sh uninstall
```

From the repository root during development:

```bash
pnpm native:uninstall
```

Reload the extension, expand `Diagnostics`, and click `Check Native Host` again. The expected unavailable status is `Native Host is not installed or not reachable.` The normalized background error code is `NATIVE_HOST_UNAVAILABLE`.

## Troubleshooting

### Native Host is not installed or not reachable

Run `bash install-macos-native-host.sh install` from the release payload, then reload Hover Trans Port from `chrome://extensions`. During development, run `pnpm helper:build:release` and `pnpm native:install`.

### Codex cannot be found

Verify Codex CLI is installed and visible in your shell:

```bash
command -v codex
codex --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so Codex must be available from a standard install path or from the environment used to launch Chrome.

### Codex is not authenticated

Run Codex CLI directly and complete its login or authentication flow.

### Translation times out

Increase Options `Timeout seconds`. The UI clamps this setting to 5-120 seconds.

### Cache needs to be cleared

Use the Options Cache section, or remove `~/.hover-trans-port/cache.sqlite`.

## Quick Translation Test

1. Install the native host with `bash install-macos-native-host.sh install` from the release payload, or run `pnpm build`, `pnpm helper:build:release`, and `pnpm native:install` during development.
2. Reload the unpacked extension from `dist/` in Chrome.
3. Open Options and confirm `Check Native Host` and `Check Provider` both succeed.
4. Open a normal page with readable text.
5. Select text or hover a paragraph, heading, or list item.
6. Press and release the left Ctrl key by itself, then confirm the inline translation appears.

If Codex is not available, the inline slot shows `Codex를 찾을 수 없습니다.`.
