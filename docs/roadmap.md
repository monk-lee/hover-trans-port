# Roadmap

This roadmap tracks public follow-up work for the developer preview. It is not a release commitment.

## Provider Support

Current executable provider:

- Codex CLI

Planned provider work:

- [ ] Claude Code CLI provider adapter.
- [ ] Gemini CLI provider adapter.
- [ ] Provider availability checks for each adapter.
- [ ] Provider-specific model settings.
- [ ] Provider selection in Options after each adapter has a safe non-interactive execution path.
- [ ] Optional provider fallback after failure behavior and privacy wording are documented.

Provider adapters must keep the current safety boundaries:

- Do not read browser cookies.
- Do not scrape or automate hidden web UIs.
- Do not store API keys, OAuth tokens, or service session tokens.
- Do not invoke providers through a shell.
- Do not allow provider approval prompts during translation.
- Keep requested text flow documented in `PRIVACY.md`.

## Packaging And Platforms

- [ ] Chrome Web Store packaging.
- [ ] Native host script installer release automation.
  - [x] Versioned native-host layout and protocol compatibility foundation.
  - [x] Compiled native helper foundation.
  - [x] macOS script installer alpha path.
  - [ ] GitHub Actions release asset build and upload.
- [ ] Windows native host install guide.
- [ ] Linux native host install guide.

## Translation UX

- [ ] Full-page translation research.
- [ ] PDF/iframe/OCR/subtitle research.
- [ ] Optional glossary or terminology consistency support.
