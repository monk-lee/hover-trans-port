# Claude Code CLI Provider Design

## Purpose

Add Claude Code CLI as a supported translation provider so existing users can choose between Codex CLI and Claude CLI without changing the native host architecture. This is a fast product-value milestone before broader installer, Windows, or Chrome Web Store work.

## Scope

In scope:

- Enable Claude CLI in the Options provider selector.
- Preserve the existing extension to native host to local CLI execution flow.
- Use the existing Rust `ClaudeProvider` as the supported execution path.
- Keep provider-specific model storage so a Claude model value does not overwrite the Codex model value.
- Treat the Claude default model as the `haiku` alias for fast translation.
- Preserve provider-aware cache isolation when cache is enabled.
- Add user-facing documentation for Claude CLI install/auth prerequisites and privacy disclosure.
- Add focused tests for Claude translation execution through the native helper.

Out of scope:

- Anthropic API key storage or direct Anthropic API calls.
- In-extension account login or token management.
- Gemini provider activation.
- Windows native host installer support.
- Chrome Web Store packaging, review, or official distribution changes.
- Large provider abstraction refactors that are not required to enable Claude CLI.

## Architecture

The extension keeps the current provider boundary:

1. Content script detects selected or hovered text.
2. Background service worker reads options and sends a `TRANSLATE` request to the native host.
3. Rust native helper chooses the requested provider.
4. Provider module invokes the local CLI and returns translated text.

Claude support should reuse this boundary. The browser extension should not know how Claude authentication works and should not hold credentials. It only stores the selected provider and optional model string.

## Components

### Provider Selection UI

`src/options.html` should allow selecting `Claude CLI`. `Gemini CLI` should remain disabled until separately validated.

`src/options/main.ts` should continue to:

- Load the selected provider from `chrome.storage.local`.
- Load the provider-specific model using `getModelForProvider`.
- Save the model under `modelsByProvider[providerId]`.
- Run `Check Provider` against the selected provider status returned by the native host.

The model selector should include common aliases for each provider. Claude should also offer a `Default (Claude CLI)` option whose stored `default` sentinel omits `--model`, allowing Claude CLI to choose its configured default. For Codex, the existing default model behavior remains unchanged.

Provider changes should not copy the previous provider's model into the newly selected provider slot. When the user changes providers, Options should refresh the model field from `modelsByProvider[newProviderId]` or that provider's default before saving the selected provider. For example, switching from Codex to Claude should not save `gpt-5.4-mini` as the Claude model unless the user explicitly enters it for Claude.

The model reset action should be provider-aware. Resetting Codex restores `gpt-5.4-mini`; resetting Claude restores `haiku`.

### Shared Provider Metadata

`src/shared/providers.ts` remains the source of provider IDs, labels, and default models.

- `codex`: default model remains `gpt-5.4-mini`.
- `claude`: default model is `haiku` for fast translation, with an explicit `default` selector option that omits `--model`.
- `gemini`: remains present in metadata but disabled in UI.

### Native Helper

`native-helper/src/providers/claude.rs` is the supported Claude execution path.

Expected command shape:

```text
claude -p "Translate according to the instructions provided on stdin. Return only the translated text." --output-format json --no-session-persistence --tools "" [--model <model>]
```

The translation prompt is supplied on stdin using the same prompt builder as Codex. The JSON response parser reads the `result` field and treats `is_error: true` as a provider execution error.

Claude should run as a constrained one-shot translation command. Use print mode, JSON output, no session persistence, and no tool access for translation requests. If a local Claude CLI version does not support one of these safety flags, that should be treated as an incompatible provider execution error rather than silently falling back to a more stateful or tool-enabled command.

No protocol version bump is required because the existing protocol already carries `provider` and `model`.

### Documentation

Update user-facing docs to describe:

- Codex CLI and Claude CLI are supported executable providers.
- Each CLI must be installed and authenticated locally by the user.
- The extension does not store CLI credentials or API keys.
- Requested text may be sent upstream by the selected provider CLI according to that provider's account, environment, and policies.
- Claude CLI support is CLI-only, not direct Anthropic API integration.

Keep README scope language accurate: this is still a developer preview with macOS native host installer support and unpacked extension install unless a separate release milestone changes that.

## Data Flow

Stored options:

- `hoverTransPort.provider`: `"codex"` or `"claude"`.
- `hoverTransPort.modelsByProvider.codex`: Codex model string.
- `hoverTransPort.modelsByProvider.claude`: Claude model alias, defaulting to `haiku`; `default` means omit `--model`.
- `hoverTransPort.codexModel`: Legacy Codex model compatibility value remains supported.

Runtime request:

1. Background resolves provider selection and model.
2. Native host receives `TRANSLATE` with `provider`, `model`, `targetLang`, `text`, `timeoutMs`, and cache setting.
3. Native helper routes `"claude"` to `ClaudeProvider`.
4. Native helper resolves the effective provider before cache lookup and cache write.
5. Cache key includes provider and model, so Codex and Claude results do not collide.
6. Cached hits report the provider that produced the cached value, not a hardcoded default provider.

## Error Handling

Expected errors should stay user-actionable:

- Claude CLI not found: provider status and translation errors should identify the selected provider as unavailable.
- Claude CLI not authenticated: surface the CLI execution failure text without implying the extension can fix credentials.
- Invalid model: surface the provider execution error and leave the model value editable.
- Malformed Claude JSON output: return an output parse error.
- Timeout: keep existing timeout handling and Options timeout control.

Provider diagnostics should remain non-destructive and should not create sessions, store credentials, or mutate provider configuration.

`Check Provider` should distinguish binary availability from authentication readiness for Claude. Prefer `claude auth status` when available because it reports login state without creating a translation session. If the implementation only checks `claude --version`, the Options UI and documentation must make that limitation explicit so users do not interpret "Available" as "authenticated and ready to translate".

Provider execution errors should preserve useful CLI failure details for user action. The background layer may localize the leading message, but it should not discard details needed to diagnose unauthenticated Claude, unsupported flags, or invalid model names.

## Testing

Add or maintain focused coverage:

- Rust command-builder test for Claude CLI args with and without model.
- Rust command-builder test proving the Claude `default` sentinel omits `--model`.
- Rust parser test for successful Claude JSON output and `is_error: true`.
- Rust bridge test using a fake `claude` executable to confirm a `TRANSLATE` request with `provider: "claude"` returns a successful `TRANSLATE_RESULT`.
- Rust cache-path test proving cached Claude and Codex translations for the same text/model do not collide, and cached Claude hits return `provider: "claude"`.
- TypeScript verification that provider/model normalization still preserves Codex defaults and Claude `haiku` defaults.
- Options provider-change verification that switching from Codex to Claude does not save the Codex model into `modelsByProvider.claude`.
- Options reset verification that Codex reset restores `gpt-5.4-mini` and Claude reset restores `haiku`.
- Translation error verification that actionable provider stderr/details survive the native helper to extension error path.
- Existing full project verification via `pnpm verify`.

Manual verification:

1. Build extension and native helper.
2. Install native host locally.
3. Open Options.
4. Select Claude CLI.
5. Run `Check Provider`.
6. Translate selected text with Claude selected.
7. Switch back to Codex and confirm Codex model and provider status still work.

## Rollout

Ship this as an incremental developer-preview feature. Release notes should describe Claude CLI support as experimental and CLI-only. Official distribution and Windows support remain future milestones.
