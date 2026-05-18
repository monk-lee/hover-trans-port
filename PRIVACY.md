# Privacy

HoverTransPort translates text only when you explicitly request it with the configured trigger.

## What The Extension Processes

When you press and release the left Control key by itself, the extension may process:

- The current selected text, if there is an active selection.
- Otherwise, readable text from the hovered page block.
- Extension settings stored in Chrome local storage.
- Native host diagnostic responses.
- Target metadata used to place or render the requested translation, such as page URL, page title, anchor rectangle, source element metadata, and inline annotation markers.

The extension does not intentionally process the full page unless the hovered readable block itself contains that text.

The local native helper receives the requested text, selected settings, and minimal request context. It does not receive the full target metadata used by the content script UI.

## Where Requested Text Goes

Requested text flows through these local components:

1. Chrome content script.
2. Chrome background service worker.
3. Chrome Native Messaging.
4. HoverTransPort local native helper.
5. The configured local provider CLI.

Supported executable providers are Codex CLI and Claude CLI. Each configured local provider CLI may send requested text upstream according to that provider CLI's account, authentication, environment, and provider policies. HoverTransPort does not store provider credentials or API keys. HoverTransPort invokes Codex CLI with `--ignore-user-config`. Claude CLI support is CLI-only; HoverTransPort does not make direct Anthropic API calls.

## What Is Stored

Chrome extension local storage may store:

- Timeout setting.
- Cache enabled setting.
- Debug logging setting.
- Target language setting.
- Provider/model settings.

The native helper may store successful translations in a local SQLite cache. The default cache path is:

```text
~/.hover-trans-port/cache.sqlite
```

Cached entries include the normalized source text and translated text. They are stored locally in plaintext SQLite unless you disable or clear the cache.

The cache key includes provider, model, target language, and normalized source text.

## What Is Not Stored By The Extension

HoverTransPort does not store:

- API keys.
- OAuth tokens.
- Browser cookies.
- Chat service session tokens.
- Full browsing history.

The extension does not request the `cookies` permission.

The helper does not store API keys, OAuth tokens, browser cookies, or service session tokens.

## Clearing Local Data

Use the Options page Cache section to clear cached translations.

Debug logging, when enabled, writes diagnostic messages to:

```text
~/.hover-trans-port/hover-trans-port.log
```

Use the Options page Debug Log controls to view or clear that log.

To remove the native host:

```bash
pnpm native:uninstall
```

To remove extension storage, remove the unpacked extension from `chrome://extensions`.

## Sensitive Content Warning

Do not use HoverTransPort on confidential, regulated, privileged, or third-party content unless you are allowed to send that content through your configured AI CLI provider.
