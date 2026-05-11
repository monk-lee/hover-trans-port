# Native Host Auto-Update Design

Date: 2026-05-11

## Goal

Add native host/helper update support without making binary replacement invisible to the user. The first version should check in the background for newer GitHub Releases, show that state in Options, and let the user run a verified update from the same place they already check native host diagnostics.

This is a staged design. Version 1 is user-confirmed update from Options. Fully unattended background updates are intentionally out of scope until the verified update path has shipped and proven reliable.

## Current Context

The extension already checks native host compatibility through `HOST_INFO`. The native helper returns `hostVersion`, `bridgeVersion`, and `protocolVersion`; the background script maps that into `NATIVE_HOST_STATUS`; and Options exposes it through `Check Native Host`.

The macOS script installer already supports `install`, `update`, `status`, and `uninstall`. It installs into a versioned directory under `~/Library/Application Support/Hover Trans Port/native-hosts/<version>/`, switches the `current` symlink atomically, writes a stable launcher, writes browser Native Messaging manifests, downloads helper assets from GitHub Releases, and verifies `checksums.txt`.

That means the update feature should reuse the existing installer/update mechanics. The extension should not download or replace native binaries directly.

One gap exists today: the one-line installer is not guaranteed to persist a local updater script because a script piped into `bash` has no stable script file path. The update-capable installer must install a versioned updater script alongside the helper so future update requests can execute a known local script with fixed arguments.

## Recommended Approach

Use a native-host mediated update flow:

1. The background page schedules a low-frequency native host update check.
2. Options can also ask the background page to check immediately.
3. The background page asks the current native host for update status.
4. The native host fetches release metadata from GitHub Releases, compares the latest supported native host version with the installed version, and returns a structured result.
5. The background page stores the latest check result in `chrome.storage.local`.
6. Options shows either “up to date”, “update available”, “manual update required”, or a concrete failure.
7. When the user clicks `Update Native Host`, the background page sends an update request to the native host.
8. The native host invokes the installed updater script with fixed `update --release-tag <tag> --host-version <version> --json` arguments.
9. The updater downloads the latest helper/checksum assets, verifies checksums, stages the new version, switches `current`, installs the new versioned updater script for future updates, and returns a JSON result.
10. Options automatically reruns `Check Native Host` after the update and shows the new version.

This keeps network/download/checksum logic in the native layer, where process execution and filesystem writes already live. It also keeps the Chrome extension’s role limited to UI, user confirmation, and messaging.

## Alternatives Considered

Extension-only update check:

- The extension can fetch GitHub release metadata and display an update button.
- It cannot safely install or swap the native helper by itself.
- It would split release parsing between TypeScript and shell/Rust.

Running `install-macos-native-host.sh update` directly from the extension:

- Chrome extensions cannot execute arbitrary local commands directly.
- Adding a generic command-runner message to the native helper would be too broad.
- A dedicated update message is safer and easier to audit.

Fully automatic background update:

- Better convenience, but higher risk for binary replacement, network failure, partial installs, and surprising provider downtime.
- Should wait until user-confirmed updates have telemetry-quality diagnostics and clear rollback behavior.

## User Experience

Add a dedicated Native Host update area inside the existing Diagnostics > Native Host section.

Default state:

- `Check Native Host` remains available and continues to show installed host/bridge/protocol versions.
- A new `Check for Updates` control queries latest native host availability.
- A new `Auto-check native host updates` setting controls scheduled checks and defaults to enabled.
- `Update Native Host` is hidden or disabled until an update is known to be available.

When up to date:

- Show installed version and latest version.
- Keep update button disabled.

When update is available:

- Show installed version, latest version, and release tag.
- Enable `Update Native Host`.
- Button copy should make the user action explicit, for example `Update Native Host`.

During update:

- Disable native host/update buttons.
- Show progress states at coarse granularity: checking, downloading, verifying, installing, reconnecting.
- Do not claim success until a post-update `HOST_INFO` call returns the expected newer version.

On failure:

- Show a concise error and keep the old native host usable when possible.
- Do not block translation unless the normal compatibility check already blocks it.
- Provide the existing manual command as fallback: `install-macos-native-host.sh update`.

When the installed native host does not support update messages, Options should report that one manual native host update is required before in-app updates can work.

## Background Check Cadence

Use `chrome.alarms` for a daily check when auto-check is enabled. Also check opportunistically when Options opens if the last stored result is older than 24 hours.

Background checks must not install or replace binaries. They only update stored status. The extension should not show browser notifications in v1; Options is the reporting surface.

## Bootstrap Constraint

The currently released v0.2.2 native host does not understand update messages and does not install a persisted updater script. Users on that host cannot be updated entirely through Options.

The first release that implements this design must treat older hosts as manual-update-required:

- The extension can detect the old host through `HOST_INFO`.
- `NATIVE_HOST_UPDATE_STATUS` against the old host will return `UNSUPPORTED_MESSAGE` or fail validation.
- Options should show a manual update command and avoid presenting an in-app update button.
- After the user installs the first update-capable native host once, later updates can use the in-app flow.

## Native Protocol

Add two dedicated native request/response pairs.

`NATIVE_HOST_UPDATE_STATUS` request:

```json
{
  "type": "NATIVE_HOST_UPDATE_STATUS",
  "requestId": "req-update-status"
}
```

Successful response:

```json
{
  "type": "NATIVE_HOST_UPDATE_STATUS_RESULT",
  "requestId": "req-update-status",
  "ok": true,
  "installedVersion": "0.2.2",
  "latestVersion": "0.2.3",
  "latestTag": "v0.2.3",
  "updateAvailable": true,
  "releaseUrl": "https://github.com/monk-lee/hover-trans-port/releases/tag/v0.2.3"
}
```

Failure response:

```json
{
  "type": "NATIVE_HOST_UPDATE_STATUS_RESULT",
  "requestId": "req-update-status",
  "ok": false,
  "error": "UPDATE_CHECK_FAILED",
  "message": "Could not check latest release.",
  "retryable": true
}
```

`NATIVE_HOST_UPDATE` request:

```json
{
  "type": "NATIVE_HOST_UPDATE",
  "requestId": "req-update",
  "targetTag": "v0.2.3"
}
```

Successful response:

```json
{
  "type": "NATIVE_HOST_UPDATE_RESULT",
  "requestId": "req-update",
  "ok": true,
  "previousVersion": "0.2.2",
  "installedVersion": "0.2.3",
  "installedPath": "/Users/name/Library/Application Support/Hover Trans Port/native-hosts/0.2.3"
}
```

Failure response:

```json
{
  "type": "NATIVE_HOST_UPDATE_RESULT",
  "requestId": "req-update",
  "ok": false,
  "error": "UPDATE_INSTALL_FAILED",
  "message": "Checksum verification failed.",
  "retryable": true
}
```

Use dedicated error codes rather than overloading provider/cache/debug errors:

- `UPDATE_UNSUPPORTED_PLATFORM`
- `UPDATE_CHECK_FAILED`
- `UPDATE_NOT_AVAILABLE`
- `UPDATE_DOWNLOAD_FAILED`
- `UPDATE_CHECKSUM_FAILED`
- `UPDATE_INSTALL_FAILED`
- `UPDATE_RECONNECT_FAILED`

## Version Selection

Version checks should use GitHub Releases, not package registry metadata. The latest eligible release is the latest non-prerelease `v*` release with required native host assets:

- `install-macos-native-host.sh`
- `checksums.txt`
- architecture-specific helper asset for the current Mac

For v1, support macOS only. Intel can remain unavailable until the release workflow produces an x64 helper asset.

The native helper should compare semantic versions after stripping the `v` prefix. A release with missing required assets should be ignored or reported as ineligible, not offered as an update.

## Installer Changes

The current installer is close to usable for this flow, but update support needs a machine-readable mode.

Add a JSON output option:

```bash
install-macos-native-host.sh update --release-tag v0.2.3 --host-version 0.2.3 --json
```

The JSON result should include:

- command
- ok
- previousVersion
- installedVersion
- installRoot
- currentLink
- helperPath
- manifests
- error/message on failure

Keep the existing human-readable output for manual use.

Also persist an updater script in each versioned native-host directory:

- If the installer is running from an inspect-first script file, copy that file into the staged version directory.
- If the installer is running from standard input, download the release `install-macos-native-host.sh` asset into the staged version directory.
- Write the updater path into `metadata.json`.
- Make the updater executable.

The installer should preserve the current rollback behavior:

- stage into `<version>.staging`
- move existing version to `<version>.backup`
- move staging into the version directory
- switch `current` via a temporary symlink
- restore or preserve the previous working version if installation fails before link switch

## Native Helper Implementation

Add an update module in Rust with narrow responsibilities:

- read current install metadata from the versioned install path when available
- resolve latest eligible release metadata
- find the persisted updater script for the active native host
- execute the updater only through a fixed internal command shape
- parse the updater JSON result
- return structured status/results to the bridge

The native helper must not expose a generic command execution API. It should only support the known update operation and fixed arguments.

Release metadata network operations should have explicit timeouts. Update installation should have a longer timeout than status checks but still be bounded.

## Security Constraints

The user must explicitly click the update button in v1. The extension should not install a native binary silently.

The update path must verify checksums from the release before switching the active helper. The native helper must not execute a newly downloaded installer script directly; it should execute only the updater script already installed with the active native host. If future releases add signatures, signature verification should happen before checksum trust is considered sufficient.

The update operation should only use the configured official release base URL by default. Environment override support may remain for tests, but Options should not expose arbitrary update URLs.

The native helper should log update attempts only when debug logging is enabled, and logs must not include credentials or provider session data.

## Failure And Recovery

Expected recoverable failures:

- GitHub release metadata unavailable
- latest release missing required native assets
- helper download failure
- checksum mismatch
- installer failure
- native host reconnect timeout after update

The old native host should remain active if installation fails before `current` changes. If the update succeeds but reconnect fails, Options should show that manual reload or browser restart may be required, then offer `Check Native Host` again.

Do not delete older version directories in v1. Keeping the previous version improves recovery and matches the current update behavior.

## Testing Plan

Add focused tests before implementation:

- TypeScript protocol types cover update status and update result responses.
- Background message handling maps update status/update requests correctly.
- Options check script verifies the update controls and status strings exist.
- Background scheduler tests verify alarm setup, stale-result checks, and disabled auto-check behavior.
- Native helper bridge tests cover update status and update result success/failure shapes.
- Rust update module tests use a local fixture release directory or mock HTTP layer to verify version comparison, missing asset handling, checksum failure, and successful install result parsing.
- Script installer tests cover `--json`, successful update, rollback-preserving failure, and status output.

Manual verification:

1. Install v0.2.2 native host.
2. Load an extension build with update support.
3. Confirm Options reports that a one-time manual native host update is required before in-app updates are available.
4. Install the first update-capable native host manually.
5. Confirm Options shows installed version and latest version when a fixture/latest release is available.
6. Click `Update Native Host`.
7. Confirm checksum verification runs and `current` points to the new version.
8. Confirm `Check Native Host` reports the new version.
9. Confirm translation still works after update.

## Rollout

Phase 1:

- Add protocol and UI for status checks only.
- No install action yet.
- This makes release metadata parsing visible and testable without binary replacement.

Phase 2:

- Add user-confirmed install action.
- Reuse installer `update` flow.
- Require post-update `HOST_INFO` verification.

Phase 3:

- Consider optional background notification.
- Still require user confirmation before install unless signing, rollback, and diagnostics are stronger.

Phase 4:

- Revisit unattended background updates only after signed assets and reliable recovery exist.

## Decisions

Use GitHub Releases as the update source for v1.

Keep v1 macOS-only.

Keep user confirmation required.

Leave automatic background installation out of scope.

Add release notes for the feature when implementation ships, not in this design-only change.
