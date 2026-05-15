# Native Host Auto Update Hardening Design

Date: 2026-05-15
Target release: 0.2.3

## Goal

Improve the existing native host auto-update feature without changing its trust model. The extension should automatically check for native host updates, clearly explain update state and failures, and let the user approve installation from Options. It must not silently install or replace the local native host executable.

## Current State

0.2.3 already includes the foundation:

- The Rust native helper handles `NATIVE_HOST_UPDATE_STATUS` and `NATIVE_HOST_UPDATE`.
- The extension checks update status on install, startup, daily alarm, and some extension use.
- Options exposes `Check for Updates`, `Update Native Host`, and an auto-check toggle.
- Popup and Options can show the one-time manual update command for old native hosts.
- The macOS installer stages the new version, updates the `current` symlink, keeps previous version directories, and records `updaterPath` in metadata.

The hardening work should refine state handling, user feedback, retry behavior, and verification around this existing design.

## Non-Goals

- Do not perform fully automatic native host installation without user approval.
- Do not add a new update server or release channel system.
- Do not change the native messaging protocol version unless a protocol break becomes unavoidable.
- Do not support non-macOS native host updates in this iteration.

## Update Policy

The selected policy is approval-based automatic updating:

- Automatic checks are enabled by default and may run in the background.
- Background checks may set stored status, badges, and Popup/Options messaging.
- Installation only runs after the user clicks `Update Native Host` in Options.
- Manual one-time update guidance remains available for update-incapable older native hosts.

This keeps update discovery automatic while avoiding silent replacement of a local executable.

## Reliability Design

Stored update status should become more useful for both UI and retry decisions. The status should continue to support the existing success/error split, with additional metadata where practical:

- `checkedAt`: when the most recent check completed.
- `nextCheckAt`: when the next automatic check is expected.
- `failureCount`: consecutive failed checks or apply attempts for the same update flow.
- `lastErrorCode`: the last update-related error code when present.
- `releaseUrl`: retained for successful update checks so users can inspect the GitHub release.

Failure handling should distinguish these cases:

- `NATIVE_HOST_UNAVAILABLE`: the extension cannot reach the native host.
- `NATIVE_HOST_UPDATE_REQUIRED`: the installed native host is too old to understand update messages, so one manual update is required.
- `UPDATE_CHECK_FAILED`: GitHub release metadata could not be loaded or parsed.
- `UPDATE_DOWNLOAD_FAILED`: the installer could not download release assets.
- `UPDATE_CHECKSUM_FAILED`: checksum verification failed and the install must not continue.
- `UPDATE_INSTALL_FAILED`: installation failed after the update request started.
- `UPDATE_RECONNECT_FAILED`: installation appeared to complete, but the extension could not verify the new host afterward.

The installer already uses staging and backup directories when replacing a version directory. The extension should preserve this model and focus on reporting clear failures, retry eligibility, and post-update verification.

## UX Design

Options remains the primary update surface. The Native Host diagnostics section should show:

- Current installed native host version when known.
- Latest compatible release version when known.
- Last successful or failed check time.
- Next automatic check time when auto-check is enabled.
- A short status message tailored to the current state.

Button behavior should reflect the current operation:

- `Check for Updates` becomes disabled while a check is running.
- `Update Native Host` is enabled only when a compatible update is available.
- During installation, both update buttons are disabled and the status says the native host is updating.
- After a retryable failure, the relevant button should be available again with clear retry wording in the status.

Popup should stay compact. When an update needs attention, it should show a short warning and direct the user to Options for details. For old native hosts, Popup and Options should continue to show the one-time manual `curl` update command.

User-facing messages should avoid implying that the browser extension itself updates the helper automatically. The copy should make clear that the extension checks automatically, while installation requires approval.

## Automation Design

The existing 24-hour alarm remains the normal successful-check cadence. Failed checks should use a conservative backoff:

- First failure: retry no sooner than 1 hour.
- Repeated failures: retry no sooner than 6 hours.
- Successful check: reset failure count and return to the normal 24-hour cadence.

Startup, install, and opportunistic use-triggered checks should respect freshness:

- If stored status is fresh, use it and avoid a new network call.
- If status is stale or requires a manual one-time update notice, refresh according to the backoff rules.
- If auto-check is disabled, preserve stored status for display but do not schedule or run background refreshes.

The badge should continue to show attention only when user action is needed:

- Update available.
- One-time manual update required.
- Extension/native host compatibility problem.

Transient network failures should not create a badge unless they leave the user unable to use native host functionality.

## Data Flow

1. Background receives a check trigger from alarm, startup, install, Options, Popup, or opportunistic extension use.
2. Background decides whether stored status is fresh enough.
3. If refresh is needed, background sends `NATIVE_HOST_UPDATE_STATUS` to the native host.
4. Native host fetches GitHub release metadata, selects the latest compatible stable release, and returns update status.
5. Background stores normalized status and updates the action badge.
6. Options and Popup render the stored status.
7. If the user clicks `Update Native Host`, Options sends `UPDATE_NATIVE_HOST` with the stored target tag and version.
8. Background forwards the update request to the native host.
9. Native host runs the persisted installer for the target release.
10. Background performs best-effort post-update host info and update status refresh.
11. Options reports success, reconnect failure, or install failure.

## Error Handling

Errors should be mapped once in `nativeClient` and rendered through shared formatting helpers. UI code should not duplicate low-level error-code interpretation.

Post-update verification is important. If the install result is successful but follow-up verification fails, the user should see that installation may have completed but Chrome or the extension may need a reload. This is different from a checksum or install failure.

Manual update guidance must remain deterministic. When the native host does not support update messages, the extension should keep showing the one-time command:

```sh
curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

## Testing

Focused verification should cover:

- TypeScript status formatting for success, update available, manual update required, retryable failures, and reconnect failure.
- Background freshness and backoff decisions.
- Badge behavior for attention and non-attention states.
- Options button state for checking, update available, updating, success, and failure.
- Native helper update checks for compatible releases, missing assets, invalid versions, and unsupported platforms.
- Existing macOS installer checks for staged install, update, metadata, and status behavior.

The existing `pnpm native-host-update:check`, `pnpm typecheck`, and `pnpm helper:test` should remain part of verification. Broader `pnpm verify` should be run before final completion if runtime allows.

## Acceptance Criteria

- The extension automatically checks for native host updates but never installs without a user click.
- Options shows enough update metadata for a user to understand current version, latest version, last check, next check, and failure state.
- Failed checks use a conservative backoff instead of retrying every opportunity.
- Retryable and non-retryable failures produce distinct user-facing messages.
- Post-install verification failure is reported separately from install failure.
- Existing first-manual-update guidance for old native hosts still works.
- Existing release and installer checks continue to pass.
