# Hover Trans Port

<p align="center">
  <img src="docs/assets/hover-trans-port-icon.svg" alt="Hover Trans Port icon" width="72" height="72">
</p>

Language: English | [한국어](readmes/README.ko.md)

![Hover Trans Port inline translation preview](docs/assets/hover-trans-port-preview.png)

Hover Trans Port is an early developer preview Chrome Manifest V3 extension for translating selected or hovered web text on demand. It uses Chrome Native Messaging to reach a local compiled helper, and the helper calls the AI CLI that is already installed and authenticated on your machine. Supported executable providers are Codex CLI and experimental Claude CLI.

This project is not affiliated with, endorsed by, or sponsored by OpenAI, Codex, Anthropic, or Claude.

## Current Scope

Works today:

- macOS, Google Chrome, and an unpacked extension loaded from `dist/`.
- Codex CLI provider and experimental Claude CLI provider.
- Selection-first translation and hovered readable block translation.
- Inline translation rendering, local SQLite cache, and Options diagnostics.
- macOS script installer for the native host.

Not yet:

- Chrome Web Store install.
- Windows/Linux native host guide.
- Gemini provider execution.
- Full-page, automatic, PDF, iframe, OCR, or subtitle translation.

## Install

### 1. Download The Extension Package

Open the [latest GitHub Release](https://github.com/monk-lee/hover-trans-port/releases/latest) and download the asset named `hover-trans-port-extension-<version>.zip`.

Unzip it somewhere you can keep it, then open `chrome://extensions`, enable Developer mode, click `Load unpacked`, and select the unzipped extension folder. Chrome loads the unpacked folder during this developer preview, not the `.zip` file itself.

### 2. Install The macOS Native Host

Install the prebuilt native host from the latest GitHub Release with `curl`:

```bash
curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

The installer downloads the architecture-specific helper, verifies `checksums.txt`, writes the stable launcher, and registers Chrome's Native Messaging manifest. Codex CLI and Claude CLI are separate prerequisites; each local CLI must already be installed and authenticated before selecting it in Options.

Inspect-first form:

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

### 3. Verify Setup

Open the extension's Options page and run both `Check Native Host` and `Check Provider`.

### Build The Extension From Source

If you want to build the unpacked extension locally instead of downloading the release package:

```bash
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable Developer mode, click `Load unpacked`, and select this repository's `dist/` folder.

Developer native-host install from source is still available:

```bash
pnpm helper:build:release
pnpm native:install
```

See [Native Host Install](docs/native-host-install.md) for native host details and troubleshooting.

## Use

1. Open a normal page with readable text.
2. Select text, or hover a paragraph, list item, or heading.
3. Optional: set `Target language` and `Trigger hotkey` in Options.
4. Press the configured trigger hotkey. The default is pressing and releasing left Control by itself.
5. Wait for the inline translation.

Common browser and editing shortcuts such as Ctrl+C or Ctrl+F are blocked from trigger recording.

## Privacy

Hover Trans Port is local-first, but not offline-only. Requested text is passed to the local helper, which invokes the configured provider CLI; it may be sent to upstream AI services according to your CLI account, authentication, environment, and provider policies.

The extension and helper do not store API keys, OAuth tokens, browser cookies, or service session tokens. If cache is enabled, normalized source text and translated text can be stored in local plaintext SQLite.

See [PRIVACY.md](PRIVACY.md).

## Development

```bash
pnpm install
pnpm verify
pnpm dev
```

Useful scripts:

- `pnpm build`: build the extension into `dist/`.
- `pnpm verify`: run project verification.
- `pnpm helper:build:release`: build the compiled Native Messaging helper.
- `pnpm native:install`: install the local Native Messaging manifest for the compiled helper.
- `pnpm native:uninstall`: uninstall the local Native Messaging host.
- `pnpm macos:script-installer:build`: build the release assets for the macOS script installer.

## Security

See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
