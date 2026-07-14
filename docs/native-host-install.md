# Native Host Install

HoverTransPort uses Chrome Native Messaging to connect the browser extension to a local compiled native helper. The helper calls local AI CLIs for requested translations.

This guide covers the current native host install paths:

- macOS
- Linux
- Windows PowerShell
- Google Chrome
- Aside on macOS
- Unpacked extension loaded from this repository's `dist/` folder
- Codex CLI as the default executable provider
- Claude CLI as an optional executable provider
- Gemini CLI as an optional executable provider
- OpenCode CLI as an optional executable provider
- Antigravity CLI as an optional executable provider

Chrome Web Store installation is not currently supported.

## Script Installer

The script installers use prebuilt native helpers from GitHub Releases. They do not require Node.js, pnpm, Cargo, Xcode, or Visual Studio on the target machine.

Download the installer from GitHub Releases, inspect it if needed, then run it on macOS or Linux:

```bash
curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.sh
bash install.sh install
```

On Windows, run PowerShell:

```powershell
Invoke-WebRequest https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1 install
```

The release must include these individual assets so the installer can fetch the right helper for the current platform:

- `install.sh`
- `install.ps1`
- `install-windows-native-host.ps1`
- `install-macos-native-host.sh`
- `checksums.txt`
- `hover-trans-port-helper-macos-arm64`
- `hover-trans-port-helper-macos-x64`, when an Intel build is available
- `hover-trans-port-helper-linux-arm64`
- `hover-trans-port-helper-linux-x64`
- `hover-trans-port-helper-windows-arm64.exe`
- `hover-trans-port-helper-windows-x64.exe`

User-facing docs prefer `install.sh` for macOS/Linux and `install.ps1` for Windows. The legacy current macOS install path, `install-macos-native-host.sh`, remains available as a compatibility entrypoint. `install-windows-native-host.ps1` remains available for updater and release compatibility.

The macOS tarball form is also supported:

```bash
tar -xzf hover-trans-port-native-host-macos-0.2.21.tar.gz
cd hover-trans-port-native-host-macos-0.2.21
bash install.sh install
```

The latest-release download form on macOS or Linux is:

```bash
curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.sh
bash install.sh install
```

Existing macOS users must run the updated installer once to add Aside registration. An older native host's persisted updater can update the helper but cannot learn a new browser manifest path. After this one-time manual install, later updates retain the Aside registration.

Useful macOS/Linux commands:

```bash
bash install.sh install
bash install.sh status
bash install.sh update
bash install.sh uninstall
```

The Windows PowerShell download form is:

```powershell
Invoke-WebRequest https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1 install
.\install.ps1 status
.\install.ps1 uninstall
```

Useful Windows PowerShell commands:

```powershell
.\install.ps1 install
.\install.ps1 status
.\install.ps1 update
.\install.ps1 uninstall
```

The installer writes the helper to `~/Library/Application Support/Hover Trans Port/native-hosts/<version>/`, updates `current`, writes the stable launcher, and registers Native Messaging manifests for the supported browsers, including Aside on macOS.

On Linux, the installer writes the helper under `~/.local/share/hover-trans-port/native-hosts/<version>/`. On Windows, the installer writes under `$env:LOCALAPPDATA\Hover Trans Port\native-hosts\<version>` and registers Chrome's Native Messaging host in the current user's registry hive.

Codex CLI, Claude CLI, Gemini CLI, OpenCode CLI, and Antigravity CLI are separate prerequisites. The installer does not store provider credentials, API keys, or browser session data.

For Antigravity translations, HoverTransPort invokes `agy --print`, which takes the full translation prompt as a process argument. Requested text may therefore be visible in local process metadata while `agy` runs.

## Updating From Options

HoverTransPort can check for native host updates in the background and show the result in Options.

The first update-capable native host must be installed manually because older native hosts do not understand update messages. v0.2.4 installs that still report helper version v0.2.3 also need one manual install because their persisted updater can copy the old helper. After that one-time update, open Options > Diagnostics > Native Host and use `Check for Updates` or `Update Native Host`.

The extension also checks occasionally when it is opened or used. If it detects an older native host that cannot update itself, Popup and Options show the one-time manual update command:

```bash
curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.sh
bash install.sh install
```

On Windows PowerShell, run:

```powershell
Invoke-WebRequest https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1 install
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

- Native host manifests in each supported browser's user-specific Native Messaging hosts directory, including Aside on macOS.
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
- `Timeout seconds`: per-request provider CLI timeout for inline hover/selection translation. The default is 30 seconds. Values are clamped to 5-120.
- `YouTube subtitle timeout seconds`: per-subtitle-chunk provider CLI timeout for YouTube caption translation. The default is 60 seconds. Values are clamped to 5-120.
- `Provider`: executable CLI used for translation. Codex is the default provider; Claude, Gemini, OpenCode, and Antigravity are optional and CLI-only.
- `Use cache`: when disabled, Local Bridge skips both cache lookup and cache write.
- `Model`: provider model alias passed as `--model <model>`. The Options page asks the native host for a provider model catalog. Providers with a stable machine-readable list, such as Codex through `codex debug models`, can show CLI-provided models. Providers without a stable list command use built-in fallback aliases and still allow custom model values when the CLI accepts a model flag. Selecting `Default (Claude CLI)`, `Default (Gemini CLI)`, or `Default (OpenCode CLI)` omits `--model` so that CLI chooses its configured default. OpenCode expects explicit custom models in `provider/model` form. Antigravity exposes only `Default (Antigravity CLI)` because `agy --print` uses the CLI-configured default model and does not accept a model flag. Codex reset restores `gpt-5.3-codex-spark`; Claude reset restores `haiku`; Gemini, OpenCode, and Antigravity reset restore the CLI default.

Invalid or unavailable model names fail at translation time and render the inline provider execution error.

Diagnostics:

- `Check Native Host`: verifies Chrome can reach the native host.
- `Check Provider`: verifies configured provider CLI binaries are available. For Claude, Gemini, OpenCode, and Antigravity, it reports binary availability; provider authentication is verified by the selected CLI when a translation runs.
- `Debug logging`: writes cache/provider diagnostics to `~/.hover-trans-port/hover-trans-port.log`. The Debug Log controls can show and clear that log.

## Cache And Logs

When cache is enabled, the native helper stores successful translations in a local SQLite database: `~/.hover-trans-port/cache.sqlite`.

Cached entries include provider, selected model, target language, normalized source text, and translated text. The Options page Cache section can clear cached translations through the Native Host.

YouTube subtitle translation uses the same local SQLite database and cache clear control. Subtitle cache entries store the video id, source caption track identity, source timeline hash, prompt version, source timed cues, and translated timed cues.

## YouTube Subtitle Translation

HoverTransPort supports YouTube videos that already expose YouTube-provided captions or automatic captions. It does not transcribe audio, run OCR, or create captions for videos without an available YouTube caption track.

On a supported YouTube watch page:

1. HoverTransPort adds a compact subtitle translation control to the YouTube player controls.
2. If YouTube already offers a caption track in the configured target language, no translation prompt is shown.
3. If translation is useful, the control asks whether to translate the available captions into the configured target language.
4. Accepted translations run through the selected local CLI provider in timed chunks. The first completed chunk can be displayed while later chunks continue in the background.
5. Translated subtitles render in a HoverTransPort overlay synced to the video timeline.

Successful subtitle translations are cached locally by video id, source caption track, source timeline hash, target language, provider, model, and prompt version. Clearing the translation cache from Options clears both inline text translations and YouTube subtitle translations.

For isolated cache tests, set `HOVER_TRANS_PORT_CACHE_PATH=/tmp/hover-trans-port-cache.sqlite`.

Debug logs, when enabled, are written to `~/.hover-trans-port/hover-trans-port.log`. The Options page Debug Log controls can view and clear this file.

Antigravity may create local workspace artifacts under `~/.hover-trans-port/antigravity-workspace` by default. These artifacts are separate from the translation cache and debug log. Remove that directory manually if you want to clear local Antigravity provider workspace state.

## Uninstall

From a script installer payload:

```bash
bash install.sh uninstall
```

On Windows PowerShell:

```powershell
.\install.ps1 uninstall
```

From the repository root during development:

```bash
pnpm native:uninstall
```

Reload the extension, expand `Diagnostics`, and click `Check Native Host` again. The expected unavailable status is `Native Host is not installed or not reachable.` The normalized background error code is `NATIVE_HOST_UNAVAILABLE`.

## Troubleshooting

### Native Host is not installed or not reachable

Run `bash install.sh install` from a macOS/Linux release payload, or `.\install.ps1 install` from a Windows PowerShell release payload, then reload HoverTransPort from `chrome://extensions`. During development, run `pnpm helper:build:release` and `pnpm native:install`.

### Codex cannot be found

Verify Codex CLI is installed and visible in your shell.

On macOS or Linux:

```bash
command -v codex
codex --version
```

On Windows PowerShell or Command Prompt:

```powershell
where codex
codex --version
```

HoverTransPort checks the official Windows installer and npm global locations in addition to `PATH`/`Path`:

- `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`
- `%CODEX_INSTALL_DIR%\codex.exe`
- `%CODEX_HOME%\packages\standalone\current\bin\codex.exe`
- `%USERPROFILE%\.codex\packages\standalone\current\bin\codex.exe`
- `%APPDATA%\npm\codex.cmd`
- `%APPDATA%\npm\codex.ps1`
- `%APPDATA%\npm\codex.exe`

On macOS/Linux, HoverTransPort also checks these standard locations in addition to `PATH`:

- `~/.local/bin/codex`
- `~/.local/share/mise/shims/codex`
- `~/.asdf/shims/codex`
- `~/.bun/bin/codex`
- `~/.npm-global/bin/codex`
- `~/.volta/bin/codex`
- `~/.nvm/current/bin/codex`
- `~/.nvm/versions/node/<default>/bin/codex`, resolved from `~/.nvm/alias/default`
- `/opt/homebrew/bin/codex`
- `/usr/local/bin/codex`
- `/home/linuxbrew/.linuxbrew/bin/codex`
- `/usr/bin/codex`

For npm installs, run `npm install -g @openai/codex`, then restart Chrome so the native host receives the updated environment. If Codex is installed somewhere else, set `HOVER_TRANS_PORT_CODEX_PATH` to the full executable path.

Then click `Check Provider` and check the resolved binary path. Chrome may not inherit your shell `PATH`, so Codex must be available from a standard install path or from the environment used to launch Chrome.

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

### Gemini cannot be found

Verify Gemini CLI is installed and visible in your shell:

```bash
command -v gemini
gemini --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so Gemini must be available from a standard install path or from the environment used to launch Chrome.

### Gemini is not authenticated

Run Gemini CLI directly and complete its authentication flow. HoverTransPort does not store Google API keys, OAuth tokens, or Gemini session credentials.

### Antigravity cannot be found

Verify Antigravity CLI is installed and visible in your shell:

```bash
command -v agy
agy --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so Antigravity must be available from a standard install path or from the environment used to launch Chrome.

### Antigravity is not authenticated

Run Antigravity CLI directly and complete its authentication flow:

```bash
agy
```

HoverTransPort does not store Google API keys, OAuth tokens, Antigravity session credentials, or browser session data.

### OpenCode cannot be found

Verify OpenCode CLI is installed and visible in your shell:

```bash
command -v opencode
opencode --version
```

Then click `Check Provider` and check the resolved binary path. Chrome on macOS may not inherit your shell `PATH`, so OpenCode must be available from a standard install path, `~/.opencode/bin/opencode`, or from the environment used to launch Chrome.

### OpenCode is not authenticated or has no default model

Run OpenCode directly and complete its authentication flow. Configure a default model in OpenCode or select one in the OpenCode TUI. HoverTransPort does not store provider API keys, OAuth tokens, or OpenCode session credentials.

HoverTransPort runs OpenCode with `--pure`, OpenCode's built-in `build` agent, stdin prompt input, and an explicit deny permission policy for tool actions. OpenCode's own permission model still governs the provider process.

### Inline translation times out

Increase Options `Timeout seconds`. The UI clamps this setting to 5-120 seconds.

### YouTube subtitle translation times out

Increase Options `YouTube subtitle timeout seconds`. This timeout is applied to each subtitle chunk, not to the whole video. A chunk timeout stops the current subtitle translation attempt and falls back to the original YouTube captions.

### Trigger hotkey does not run

Some browsers, including ChatGPT Atlas, may not deliver standalone modifier keys like Left Control to extensions. If the default trigger does not work on a page, choose any key combination that works for your browser in Options.

### Cache needs to be cleared

Use the Options Cache section, or remove `~/.hover-trans-port/cache.sqlite`.

## Quick Translation Test

1. Install the native host with `bash install.sh install` from a macOS/Linux release payload or `.\install.ps1 install` from a Windows PowerShell release payload. During development, run `pnpm build`, `pnpm helper:build:release`, and `pnpm native:install`.
2. Reload the unpacked extension from `dist/` in Chrome.
3. Open Options and confirm `Check Native Host` and `Check Provider` both succeed.
4. Open a normal page with readable text.
5. Select text or hover a paragraph, heading, or list item.
6. Press and release the left Ctrl key by itself, then confirm the inline translation appears.

If the selected provider is not available, the inline slot shows a provider-specific unavailable message.
