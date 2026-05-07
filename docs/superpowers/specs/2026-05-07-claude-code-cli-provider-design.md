# Claude Code CLI Provider Design

## Purpose

Add Claude Code CLI as a supported translation provider so existing users can choose between Codex CLI and Claude CLI without changing the native host architecture. This is a fast product-value milestone before broader installer, Windows, or Chrome Web Store work.

## Scope

In scope:

- Enable Claude CLI in the Options provider selector.
- Preserve the existing extension to native host to local CLI execution flow.
- Use the existing Rust `ClaudeProvider` as the supported execution path.
- Keep provider-specific model storage so a Claude model value does not overwrite the Codex model value.
- Treat an empty Claude model as "use the Claude CLI default model".
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

The model input should be allowed to stay empty for Claude. For Codex, the existing default model behavior remains unchanged.

The model reset action should be provider-aware. Resetting Codex restores `gpt-5.4-mini`; resetting Claude clears the model field so Claude CLI uses its configured default.

### Shared Provider Metadata

`src/shared/providers.ts` remains the source of provider IDs, labels, and default models.

- `codex`: default model remains `gpt-5.4-mini`.
- `claude`: default model remains empty so Claude CLI uses its own configured default.
- `gemini`: remains present in metadata but disabled in UI.

### Native Helper

`native-helper/src/providers/claude.rs` is the supported Claude execution path.

Expected command shape:

```text
claude -p "Translate according to the instructions provided on stdin. Return only the translated text." --output-format json [--model <model>]
```

The translation prompt is supplied on stdin using the same prompt builder as Codex. The JSON response parser reads the `result` field and treats `is_error: true` as a provider execution error.

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
- `hoverTransPort.modelsByProvider.claude`: Optional Claude model string, usually empty.
- `hoverTransPort.codexModel`: Legacy Codex model compatibility value remains supported.

Runtime request:

1. Background resolves provider selection and model.
2. Native host receives `TRANSLATE` with `provider`, `model`, `targetLang`, `text`, `timeoutMs`, and cache setting.
3. Native helper routes `"claude"` to `ClaudeProvider`.
4. Cache key includes provider and model, so Codex and Claude results do not collide.

## Error Handling

Expected errors should stay user-actionable:

- Claude CLI not found: provider status and translation errors should identify the selected provider as unavailable.
- Claude CLI not authenticated: surface the CLI execution failure text without implying the extension can fix credentials.
- Invalid model: surface the provider execution error and leave the model value editable.
- Malformed Claude JSON output: return an output parse error.
- Timeout: keep existing timeout handling and Options timeout control.

Provider diagnostics should remain non-destructive and should not create sessions, store credentials, or mutate provider configuration.

## Testing

Add or maintain focused coverage:

- Rust command-builder test for Claude CLI args with and without model.
- Rust parser test for successful Claude JSON output and `is_error: true`.
- Rust bridge test using a fake `claude` executable to confirm a `TRANSLATE` request with `provider: "claude"` returns a successful `TRANSLATE_RESULT`.
- TypeScript verification that provider/model normalization still preserves Codex defaults and allows empty Claude models.
- Options reset verification that Codex reset restores `gpt-5.4-mini` and Claude reset clears the model field.
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
