# Security

## Supported Versions

The public developer-preview branch is `main`.

Only the latest commit on `main` is supported for security fixes until versioned releases are introduced.

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities.

Use GitHub private vulnerability reporting for this repository. If that is unavailable, contact the maintainers privately before publishing details.

Include:

- Affected commit or release.
- Operating system and Chrome version.
- Reproduction steps.
- Whether the issue involves the extension, native host, provider CLI invocation, cache, or documentation.
- Any logs needed to understand the issue, with private text removed.

## Security Model

HoverTransPort uses Chrome Native Messaging to call a local native host. The native host invokes the selected provider CLI as a subprocess for requested translations.

The native host should:

- Use no shell invocation for provider execution.
- Run Codex CLI in ephemeral mode and Claude CLI/Gemini CLI/Antigravity CLI in non-interactive print mode.
- Use read-only sandbox mode or an empty provider workspace/tool allowlist where the provider supports it.
- Avoid approval prompts.
- Use no browser cookies or service tokens.
- Avoid storing API keys or OAuth tokens.

## Known Security Boundaries

The extension can read selected or hovered page text on pages where its content script runs.

The native host can execute the configured provider CLI on the local machine.

The selected provider CLI may communicate with upstream AI services according to that provider account, authentication, environment, and provider policies. HoverTransPort invokes Codex CLI with `--ignore-user-config`. Antigravity support invokes the local Antigravity CLI and does not make direct Google API calls.

## Out Of Scope

The first public developer preview does not claim to provide:

- Enterprise data loss prevention.
- Offline-only translation.
- Full isolation from the configured AI CLI provider.
- Support for untrusted local provider binaries.
