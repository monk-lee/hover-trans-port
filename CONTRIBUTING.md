# Contributing

Thanks for helping improve Hover Trans Port.

## Current Scope

The current public preview is focused on:

- macOS.
- Chrome MV3.
- Unpacked extension installation.
- Codex CLI provider.
- Selection and hover block translation.
- Native host diagnostics.
- Privacy and security documentation.

Please open an issue before starting large changes such as new providers, installers, Chrome Web Store packaging, or cross-platform native host work.

## Development Setup

```bash
pnpm install
pnpm verify
```

For extension development:

```bash
pnpm dev
```

Load the `dist/` folder from `chrome://extensions`.

For native host testing:

```bash
pnpm build
pnpm native:install
```

## Verification

Run before opening a pull request:

```bash
pnpm verify
```

If your change touches native host install behavior, also manually test:

```bash
pnpm native:uninstall
pnpm native:install
```

## Pull Request Expectations

Every pull request should include:

- What changed.
- Why it changed.
- How it was verified.
- Whether requested page text, local cache, provider CLI invocation, or permissions are affected.
- Documentation updates for user-visible behavior.

## Privacy And Security

Do not add browser cookie access, web service session scraping, hidden web UI automation, or token storage.

Do not broaden host permissions without explaining the user benefit and privacy impact.
