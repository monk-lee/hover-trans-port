# Hover Trans Port

<p align="center">
  <img src="docs/assets/hover-trans-port-icon.svg" alt="Hover Trans Port icon" width="72" height="72">
</p>

Language: English | [한국어](readmes/README.ko.md)

![Hover Trans Port inline translation preview](docs/assets/hover-trans-port-preview.png)

Hover Trans Port is an early developer preview Chrome Manifest V3 extension for translating selected or hovered web text on demand. It uses Chrome Native Messaging to reach a local compiled helper, and the helper calls the AI CLI that is already installed and authenticated on your machine. The current executable provider is Codex CLI.

This project is not affiliated with, endorsed by, or sponsored by OpenAI or Codex.

## Current Scope

Works today:

- macOS, Google Chrome, and an unpacked extension loaded from `dist/`.
- Codex CLI provider.
- Selection-first translation and hovered readable block translation.
- Inline translation rendering, local SQLite cache, and Options diagnostics.
- macOS script installer for the native host.

Not yet:

- Chrome Web Store install.
- Windows/Linux native host guide.
- Claude/Gemini provider execution.
- Full-page, automatic, PDF, iframe, OCR, or subtitle translation.

See [Roadmap](docs/roadmap.md) for planned follow-up work.

## Install

### 1. Install The macOS Native Host

Install the prebuilt native host from the latest GitHub Release with `curl`:

```bash
curl -fsSL https://github.com/dev-monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

The installer downloads the architecture-specific helper, verifies `checksums.txt`, writes the stable launcher, and registers Chrome's Native Messaging manifest. Codex CLI is still a separate prerequisite and must already be installed and authenticated locally.

Inspect-first form:

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

### 2. Load The Extension

The extension itself is still installed as an unpacked developer-preview build:

```bash
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable Developer mode, click `Load unpacked`, and select this repository's `dist/` folder. Open Options and run both `Check Native Host` and `Check Provider`.

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
