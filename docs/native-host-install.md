# Native Host Install

HoverTransPort uses Chrome Native Messaging to connect the browser extension to a local compiled native helper. The helper calls local AI CLIs for requested translations.

This guide covers the current macOS install path:

- macOS
- Google Chrome
- Unpacked extension loaded from this repository's `dist/` folder
- Codex CLI as the default executable provider
- Claude CLI as an optional executable provider

Chrome Web Store installation is not currently supported.

## Script Installer

The macOS install path is the script installer. It installs the prebuilt native helper without Node.js, pnpm, Cargo, or Xcode.

For a one-line install from GitHub Releases:

```bash
curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

The release must include these individual assets so the curl installer can fetch the right helper for the current Mac:

- `install-macos-native-host.sh`
- `checksums.txt`
- `hover-trans-port-helper-macos-arm64`
- `hover-trans-port-helper-macos-x64`, when an Intel build is available

The tarball form is also supported:

```bash
tar -xzf hover-trans-port-native-host-macos-0.2.6.tar.gz
cd hover-trans-port-native-host-macos-0.2.6
bash install-macos-native-host.sh install
```

The safer inspect-first form is:

```bash
curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh
bash install-macos-native-host.sh install
```

Useful commands:

```bash
bash install-macos-native-host.sh status
bash install-macos-native-host.sh update
bash install-macos-native-host.sh uninstall
```

The installer writes the helper to `~/Library/Application Support/HoverTransPort/native-hosts/<version>/`, updates `current`, writes the stable launcher, and registers Chrome's Native Messaging manifest.

Codex CLI and Claude CLI are separate prerequisites. The installer does not store provider credentials, API keys, or browser session data.

## Updating From Options

HoverTransPort can check for native host updates in the background and show the result in Options.

The first update-capable native host must be installed manually because older native hosts do not understand update messages. v0.2.4 installs that still report helper version v0.2.3 also need one manual install because their persisted updater can copy the old helper. After that one-time update, open Options > Diagnostics > Native Host and use `Check for Updates` or `Update Native Host`.

The extension also checks occasionally when it is opened or used. If it detects an older native host that cannot update itself, Popup and Options show the one-time manual update command:

```bash
curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

Updates are user-confirmed. The extension does not silently replace the native helper.

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
2. Reload HoverTransPort.
3. Open the extension Options page.
4. Click `Check Provider` in `Translation Provider`.
5. Expand `Diagnostics` and click `Check Native Host`.

Expected results: `Check Provider` shows the selected provider CLI as available, and `Check Native Host` shows the bridge is connected.

## Options

Common settings:

- `Target language`: translation output language. Choose `Korean` for Korean output.
- `Timeout seconds`: per-request provider CLI timeout. The default is 30 seconds. Values are clamped to 5-120.
- `Provider`: executable CLI used for translation. Codex is the default provider; Claude is optional and CLI-only.
- `Use cache`: when disabled, Local Bridge skips both cache lookup and cache write.
- `Model`: provider model alias passed as `--model <model>`. The Options page asks the native host for a provider model catalog. Providers with a stable machine-readable list, such as Codex through `codex debug models`, can show CLI-provided models. Providers without a stable list command use built-in fallback aliases and still allow custom model values. Selecting `Default (Claude CLI)` omits `--model` so Claude CLI chooses its configured default. Codex reset restores `gpt-5.4-mini`; Claude reset restores `haiku`.

Invalid or unavailable model names fail at translation time and render the inline provider execution error.

Diagnostics:

- `Check Native Host`: verifies Chrome can reach the native host.
- `Check Provider`: verifies configured provider CLI binaries are available. For Claude, it reports binary availability; Claude authentication is verified by Claude CLI when a translation runs.
- `Debug logging`: writes cache/provider diagnostics to `~/.hover-trans-port/hover-trans-port.log`. The Debug Log controls can show and clear that log.

## Cache And Logs

When cache is enabled, the native helper stores successful translations in a local SQLite database: `~/.hover-trans-port/cache.sqlite`.

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

Run `bash install-macos-native-host.sh install` from the release payload, then reload HoverTransPort from `chrome://extensions`. During development, run `pnpm helper:build:release` and `pnpm native:install`.

### Codex cannot be found

Verify Codex CLI is installed and visible in your shell:

```bash
command -v codex
codex --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so Codex must be available from a standard install path or from the environment used to launch Chrome.

### Codex is not authenticated

Run Codex CLI directly and complete its login or authentication flow.

### Claude cannot be found

Verify Claude CLI is installed and visible in your shell:

```bash
command -v claude
claude --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so Claude must be available from a standard install path or from the environment used to launch Chrome.

### Claude is not authenticated

Run Claude CLI directly and complete its login or authentication flow. HoverTransPort does not store Anthropic API keys, OAuth tokens, or Claude session credentials.

### Translation times out

Increase Options `Timeout seconds`. The UI clamps this setting to 5-120 seconds.

### Trigger hotkey does not run

Some browsers, including ChatGPT Atlas, may not deliver standalone modifier keys like Left Control to extensions. If the default trigger does not work on a page, choose any key combination that works for your browser in Options.

### Cache needs to be cleared

Use the Options Cache section, or remove `~/.hover-trans-port/cache.sqlite`.

## Quick Translation Test

1. Install the native host with `bash install-macos-native-host.sh install` from the release payload, or run `pnpm build`, `pnpm helper:build:release`, and `pnpm native:install` during development.
2. Reload the unpacked extension from `dist/` in Chrome.
3. Open Options and confirm `Check Native Host` and `Check Provider` both succeed.
4. Open a normal page with readable text.
5. Select text or hover a paragraph, heading, or list item.
6. Press and release the left Ctrl key by itself, then confirm the inline translation appears.

If the selected provider is not available, the inline slot shows a provider-specific unavailable message.
