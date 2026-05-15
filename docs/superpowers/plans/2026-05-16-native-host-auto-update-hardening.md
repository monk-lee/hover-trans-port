# Native Host Auto Update Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the 0.2.3 native host auto-update flow with richer status metadata, clearer Options/Popup UX, conservative retry backoff, and explicit post-update reconnect warnings while preserving user-approved installation.

**Architecture:** Keep native update protocol behavior intact and enhance the extension-side state model. `src/shared/nativeHostUpdate.ts` owns formatting and backoff helpers, `src/background/service-worker.ts` owns storage/freshness/badge decisions, and Options/Popup render the normalized stored status without duplicating low-level error mapping.

**Tech Stack:** Chrome MV3 extension, TypeScript, Vite, Node-based check scripts, Rust native helper tests where needed.

---

## File Structure

- Modify `src/shared/messages.ts`: extend `NativeHostUpdateStoredStatus` with required metadata fields.
- Modify `src/shared/nativeHostUpdate.ts`: add shared timing constants, metadata helpers, message formatting, attention logic, and retry/backoff helpers.
- Modify `src/background/nativeClient.ts`: populate required metadata for all update status results.
- Modify `src/background/service-worker.ts`: use backoff/freshness helpers, persist reconnect failures after successful installs, and keep badge behavior action-oriented.
- Modify `src/options.html`: add structured update metadata fields in Diagnostics > Native Host.
- Modify `src/options/options.css`: style compact update metadata rows.
- Modify `src/options/main.ts`: render richer update status, button states, and reconnect warnings.
- Modify `src/popup/main.ts`: keep compact warning behavior and make update copy route details to Options.
- Modify `scripts/native-host-update-check.mjs`: assert new helper names, metadata fields, backoff behavior, and reconnect failure handling.
- Modify `scripts/popup-options-open-check.mjs`: update fake update status shape and assert compact Popup guidance still works.
- Optionally modify `docs/native-host-install.md`: only if final UI copy changes the documented manual update guidance.

---

### Task 1: Extend Stored Status Metadata And Shared Helpers

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/shared/nativeHostUpdate.ts`
- Test: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Update the guard script before implementation**

Add these needles to the `src/shared/nativeHostUpdate.ts` entry in `scripts/native-host-update-check.mjs`:

```js
"NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS",
"NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS",
"NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS",
"createNativeHostUpdateMetadata",
"getNativeHostUpdateNextCheckAt",
"isNativeHostUpdateRefreshDue",
"formatNativeHostUpdateStatusForUser"
```

Add these needles to the `src/shared/messages.ts` entry:

```js
"nextCheckAt",
"failureCount",
"lastErrorCode"
```

- [ ] **Step 2: Run the failing guard**

Run: `pnpm native-host-update:check`

Expected: FAIL, naming at least one missing helper or metadata field from Step 1.

- [ ] **Step 3: Extend the stored status type**

In `src/shared/messages.ts`, change `NativeHostUpdateStoredStatus` to include required metadata on both success and error states:

```ts
export type NativeHostUpdateMetadata = {
  checkedAt: number;
  nextCheckAt: number;
  failureCount: number;
  lastErrorCode?: NativeHostUpdateStoredErrorCode;
};

export type NativeHostUpdateStoredErrorCode =
  | "NATIVE_HOST_UNAVAILABLE"
  | "NATIVE_HOST_UPDATE_REQUIRED"
  | "NATIVE_HOST_UNSUPPORTED"
  | "UPDATE_UNSUPPORTED_PLATFORM"
  | "UPDATE_CHECK_FAILED"
  | "UPDATE_NOT_AVAILABLE"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_CHECKSUM_FAILED"
  | "UPDATE_INSTALL_FAILED"
  | "UPDATE_RECONNECT_FAILED"
  | "INVALID_MESSAGE"
  | "UNKNOWN_ERROR";

export type NativeHostUpdateStoredStatus =
  | (NativeHostUpdateMetadata & {
      ok: true;
      installedVersion: string;
      latestVersion: string;
      latestTag: string;
      updateAvailable: boolean;
      releaseUrl: string;
    })
  | (NativeHostUpdateMetadata & {
      ok: false;
      error: NativeHostUpdateStoredErrorCode;
      message: string;
      retryable: boolean;
      manualUpdateRequired?: boolean;
    });
```

- [ ] **Step 4: Add shared metadata/backoff helpers**

In `src/shared/nativeHostUpdate.ts`, add these exports near the top:

```ts
export const NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS = 60 * 60 * 1000;
export const NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;

type NativeHostUpdateMetadataInput = {
  checkedAt?: number;
  previousStatus?: NativeHostUpdateStoredStatus;
  error?: NativeHostUpdateStoredErrorCode;
};

export function getNativeHostUpdateNextCheckAt(
  checkedAt: number,
  failureCount: number
): number {
  if (failureCount <= 0) {
    return checkedAt + NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS;
  }

  if (failureCount === 1) {
    return checkedAt + NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS;
  }

  return checkedAt + NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS;
}

export function createNativeHostUpdateMetadata({
  checkedAt = Date.now(),
  previousStatus,
  error
}: NativeHostUpdateMetadataInput = {}) {
  const failureCount = error
    ? previousStatus?.ok === false
      ? previousStatus.failureCount + 1
      : 1
    : 0;

  return {
    checkedAt,
    nextCheckAt: getNativeHostUpdateNextCheckAt(checkedAt, failureCount),
    failureCount,
    lastErrorCode: error
  };
}

export function isNativeHostUpdateRefreshDue(
  status: NativeHostUpdateStoredStatus | undefined,
  now = Date.now()
): boolean {
  return !status || now >= status.nextCheckAt;
}
```

- [ ] **Step 5: Make formatter copy distinguish reconnect and retryable failures**

Update `formatNativeHostUpdateStatusForUser` in `src/shared/nativeHostUpdate.ts` so these cases have explicit messages:

```ts
if (status.error === "UPDATE_RECONNECT_FAILED") {
  return {
    title: "Native Host update verification needed",
    detail:
      "The update may have installed, but the extension could not reconnect to verify it. Reload the extension or Chrome, then check again.",
    attention: false
  };
}

if (status.retryable) {
  return {
    title: "Native Host update check failed",
    detail: `${status.message} You can retry from Options.`,
    attention: false
  };
}
```

Keep the existing manual update and unsupported-host branches before the retryable branch.

- [ ] **Step 6: Run the guard and typecheck**

Run: `pnpm native-host-update:check`

Expected: PASS with `native-host-update-check: ok`.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/shared/messages.ts src/shared/nativeHostUpdate.ts scripts/native-host-update-check.mjs
git commit -m "feat: extend native host update status metadata"
```

---

### Task 2: Populate Metadata In Native Client

**Files:**
- Modify: `src/background/nativeClient.ts`
- Test: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Update guard script for metadata creation**

In `scripts/native-host-update-check.mjs`, add these needles to the `src/background/nativeClient.ts` entry:

```js
"createNativeHostUpdateMetadata",
"previousStatus?: NativeHostUpdateStoredStatus"
```

Add an `assertMatches` after the existing native client checks:

```js
assertMatches(
  nativeClientText,
  /checkNativeHostUpdateStatus\(\s*requestId: string,\s*previousStatus\?: NativeHostUpdateStoredStatus\s*\)[\s\S]*createNativeHostUpdateMetadata/u,
  "src/background/nativeClient.ts",
  "update status metadata is created in native client"
);
```

- [ ] **Step 2: Run the failing guard**

Run: `pnpm native-host-update:check`

Expected: FAIL because `checkNativeHostUpdateStatus` does not accept `previousStatus` yet.

- [ ] **Step 3: Import metadata helper**

In `src/background/nativeClient.ts`, add:

```ts
import { createNativeHostUpdateMetadata } from "../shared/nativeHostUpdate";
```

- [ ] **Step 4: Update `checkNativeHostUpdateStatus` signature**

Change:

```ts
export async function checkNativeHostUpdateStatus(
  requestId: string
): Promise<NativeHostUpdateStoredStatus> {
```

to:

```ts
export async function checkNativeHostUpdateStatus(
  requestId: string,
  previousStatus?: NativeHostUpdateStoredStatus
): Promise<NativeHostUpdateStoredStatus> {
```

- [ ] **Step 5: Use metadata for successful status**

Replace the success return object prefix with:

```ts
return {
  ...createNativeHostUpdateMetadata({ checkedAt, previousStatus }),
  ok: true,
  installedVersion: response.installedVersion,
  latestVersion: response.latestVersion,
  latestTag: response.latestTag,
  updateAvailable: response.updateAvailable,
  releaseUrl: response.releaseUrl
};
```

- [ ] **Step 6: Use metadata for error statuses**

For each error return in `checkNativeHostUpdateStatus`, add metadata first. Example for unsupported message:

```ts
return {
  ...createNativeHostUpdateMetadata({
    checkedAt,
    previousStatus,
    error: "NATIVE_HOST_UPDATE_REQUIRED"
  }),
  ok: false,
  error: "NATIVE_HOST_UPDATE_REQUIRED",
  message:
    "One manual native host update is required before in-app updates are available.",
  retryable: false,
  manualUpdateRequired: true
};
```

For mapped native update errors, compute first:

```ts
const error = toNativeHostUpdateStoredError(response.error);
return {
  ...createNativeHostUpdateMetadata({ checkedAt, previousStatus, error }),
  ok: false,
  error,
  message: response.message,
  retryable: response.retryable
};
```

- [ ] **Step 7: Run guard and typecheck**

Run: `pnpm native-host-update:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/background/nativeClient.ts scripts/native-host-update-check.mjs
git commit -m "feat: populate native host update metadata"
```

---

### Task 3: Apply Freshness Backoff In Background

**Files:**
- Modify: `src/background/service-worker.ts`
- Test: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Update guard script for background helper usage**

Add these needles to the `src/background/service-worker.ts` entry:

```js
"isNativeHostUpdateRefreshDue",
"previousStatus",
"nextCheckAt"
```

Replace the stale-status assertion with:

```js
assertMatches(
  serviceWorkerText,
  /function shouldRefreshNativeHostUpdateStatus[\s\S]*isNativeHostUpdateRefreshDue\(status\)/u,
  "src/background/service-worker.ts",
  "native host update refresh uses nextCheckAt backoff"
);
```

- [ ] **Step 2: Run the failing guard**

Run: `pnpm native-host-update:check`

Expected: FAIL because service worker still uses `NATIVE_HOST_UPDATE_STALE_MS`.

- [ ] **Step 3: Import backoff helper**

In `src/background/service-worker.ts`, change the native host update import to:

```ts
import {
  isNativeHostUpdateRefreshDue,
  nativeHostUpdateNeedsAttention
} from "../shared/nativeHostUpdate";
```

- [ ] **Step 4: Remove stale interval constant**

Remove:

```ts
const NATIVE_HOST_UPDATE_STALE_MS = 24 * 60 * 60 * 1000;
```

Keep `NATIVE_HOST_UPDATE_CHECK_INTERVAL_MINUTES` for Chrome's daily alarm.

- [ ] **Step 5: Pass previous status into refresh**

Change `refreshNativeHostUpdateStatus` to:

```ts
async function refreshNativeHostUpdateStatus(
  requestId: string,
  previousStatus?: NativeHostUpdateStoredStatus
): Promise<NativeHostUpdateStoredStatus> {
  const status = await checkNativeHostUpdateStatus(requestId, previousStatus);
  await storeNativeHostUpdateStatus(status);
  return status;
}
```

Change the refresh call in `maybeRefreshNativeHostUpdateStatus` to:

```ts
return refreshNativeHostUpdateStatus(requestId, status);
```

- [ ] **Step 6: Replace stale logic**

Remove `isNativeHostUpdateStatusStale`. Replace `shouldRefreshNativeHostUpdateStatus` with:

```ts
function shouldRefreshNativeHostUpdateStatus(
  status: NativeHostUpdateStoredStatus | undefined
): boolean {
  if (isNativeHostUpdateRefreshDue(status)) {
    return true;
  }

  if (!status.ok) {
    return (
      status.manualUpdateRequired === true ||
      status.error === "NATIVE_HOST_UPDATE_REQUIRED"
    );
  }

  return false;
}
```

- [ ] **Step 7: Run guard and typecheck**

Run: `pnpm native-host-update:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/background/service-worker.ts scripts/native-host-update-check.mjs
git commit -m "feat: back off native host update checks"
```

---

### Task 4: Store Reconnect Failure After Successful Install

**Files:**
- Modify: `src/background/service-worker.ts`
- Test: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Update guard script for reconnect failure storage**

Add this assertion to `scripts/native-host-update-check.mjs`:

```js
assertMatches(
  serviceWorkerText,
  /function createNativeHostUpdateReconnectFailedStatus[\s\S]*UPDATE_RECONNECT_FAILED[\s\S]*storeNativeHostUpdateStatus/u,
  "src/background/service-worker.ts",
  "post-update reconnect failure is stored"
);
```

- [ ] **Step 2: Run the failing guard**

Run: `pnpm native-host-update:check`

Expected: FAIL because reconnect failure is currently swallowed.

- [ ] **Step 3: Import metadata helper**

In `src/background/service-worker.ts`, extend the native host update import:

```ts
import {
  createNativeHostUpdateMetadata,
  isNativeHostUpdateRefreshDue,
  nativeHostUpdateNeedsAttention
} from "../shared/nativeHostUpdate";
```

- [ ] **Step 4: Add reconnect failure status factory**

Add near `storeNativeHostUpdateStatus`:

```ts
function createNativeHostUpdateReconnectFailedStatus(
  previousStatus: NativeHostUpdateStoredStatus | undefined
): NativeHostUpdateStoredStatus {
  return {
    ...createNativeHostUpdateMetadata({
      previousStatus,
      error: "UPDATE_RECONNECT_FAILED"
    }),
    ok: false,
    error: "UPDATE_RECONNECT_FAILED",
    message:
      "Native host update installed, but the extension could not verify the new host. Reload Chrome or the extension, then check again.",
    retryable: true
  };
}
```

- [ ] **Step 5: Make post-update refresh store reconnect failure**

Replace `refreshPostNativeHostUpdateStatus` with:

```ts
async function refreshPostNativeHostUpdateStatus(
  requestId: string
): Promise<void> {
  const stored = (await chrome.storage.local.get(
    NATIVE_HOST_UPDATE_STORAGE_KEY
  )) as NativeHostUpdateStorage;
  const previousStatus = stored.hoverTransPortNativeHostUpdate;

  try {
    await checkNativeHost(`${requestId}:host-info`);
    await refreshNativeHostUpdateStatus(`${requestId}:status`, previousStatus);
  } catch {
    await storeNativeHostUpdateStatus(
      createNativeHostUpdateReconnectFailedStatus(previousStatus)
    );
  }
}
```

- [ ] **Step 6: Run guard and typecheck**

Run: `pnpm native-host-update:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/background/service-worker.ts scripts/native-host-update-check.mjs
git commit -m "feat: report native host update reconnect failures"
```

---

### Task 5: Render Rich Update Metadata In Options

**Files:**
- Modify: `src/options.html`
- Modify: `src/options/options.css`
- Modify: `src/options/main.ts`
- Test: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Update guard script for Options metadata UI**

Add these `assertIncludes` checks in `scripts/native-host-update-check.mjs` after the Options HTML assertions:

```js
assertIncludes(
  optionsHtml,
  'id="native-host-update-meta"',
  "Options update metadata list"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-current-version"',
  "Options current native host version metadata"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-latest-version"',
  "Options latest native host version metadata"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-last-checked"',
  "Options update last checked metadata"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-next-check"',
  "Options update next check metadata"
);
```

Add these `assertIncludes` checks for `optionsMain`:

```js
assertIncludes(optionsMain, "setNativeHostUpdateChecking", "Options check button busy state");
assertIncludes(optionsMain, "setNativeHostUpdateApplying", "Options apply button busy state");
assertIncludes(optionsMain, "formatNativeHostUpdateDateTime", "Options formats update timestamps");
```

- [ ] **Step 2: Run the failing guard**

Run: `pnpm native-host-update:check`

Expected: FAIL because the metadata elements do not exist yet.

- [ ] **Step 3: Add metadata markup**

In `src/options.html`, place this after `#native-host-update-status`:

```html
<dl id="native-host-update-meta" class="native-host-update-meta">
  <div>
    <dt>Current</dt>
    <dd id="native-host-update-current-version">Unknown</dd>
  </div>
  <div>
    <dt>Latest</dt>
    <dd id="native-host-update-latest-version">Unknown</dd>
  </div>
  <div>
    <dt>Last checked</dt>
    <dd id="native-host-update-last-checked">Never</dd>
  </div>
  <div>
    <dt>Next check after</dt>
    <dd id="native-host-update-next-check">Unknown</dd>
  </div>
</dl>
```

- [ ] **Step 4: Style metadata rows**

In `src/options/options.css`, add after `.native-host-update-status`:

```css
.native-host-update-meta {
  display: grid;
  gap: 6px;
  max-width: 560px;
  margin: 10px 0 0;
  color: #374151;
  font-size: 13px;
  line-height: 1.35;
}

.native-host-update-meta div {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
}

.native-host-update-meta dt {
  color: #5b6472;
  font-weight: 700;
}

.native-host-update-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Add DOM references and UI helpers**

In `src/options/main.ts`, add DOM references near the existing update elements:

```ts
const nativeHostUpdateCurrentVersion = document.querySelector<HTMLElement>(
  "#native-host-update-current-version"
);
const nativeHostUpdateLatestVersion = document.querySelector<HTMLElement>(
  "#native-host-update-latest-version"
);
const nativeHostUpdateLastChecked = document.querySelector<HTMLElement>(
  "#native-host-update-last-checked"
);
const nativeHostUpdateNextCheck = document.querySelector<HTMLElement>(
  "#native-host-update-next-check"
);
```

Add helpers near `setNativeHostUpdateApplyEnabled`:

```ts
function setNativeHostUpdateChecking(checking: boolean) {
  if (nativeHostUpdateCheckButton) {
    nativeHostUpdateCheckButton.disabled = checking;
    nativeHostUpdateCheckButton.textContent = checking
      ? "Checking..."
      : "Check for Updates";
  }
}

function setNativeHostUpdateApplying(applying: boolean) {
  if (nativeHostUpdateApplyButton) {
    nativeHostUpdateApplyButton.disabled = applying;
    nativeHostUpdateApplyButton.textContent = applying
      ? "Updating..."
      : "Update Native Host";
  }
}

function setNativeHostUpdateMeta(
  currentVersion: string,
  latestVersion: string,
  lastChecked: string,
  nextCheck: string
) {
  if (nativeHostUpdateCurrentVersion) {
    nativeHostUpdateCurrentVersion.textContent = currentVersion;
  }
  if (nativeHostUpdateLatestVersion) {
    nativeHostUpdateLatestVersion.textContent = latestVersion;
  }
  if (nativeHostUpdateLastChecked) {
    nativeHostUpdateLastChecked.textContent = lastChecked;
  }
  if (nativeHostUpdateNextCheck) {
    nativeHostUpdateNextCheck.textContent = nextCheck;
  }
}

function formatNativeHostUpdateDateTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}
```

- [ ] **Step 6: Render metadata from status**

At the start of `renderNativeHostUpdateStatus`, set defaults for missing status:

```ts
if (!status) {
  setNativeHostUpdateStatus("Update status not checked.");
  setNativeHostUpdateMeta("Unknown", "Unknown", "Never", "Unknown");
  setNativeHostUpdateApplyEnabled(false);
  return;
}
```

After the missing-status branch, add:

```ts
setNativeHostUpdateMeta(
  status.ok ? status.installedVersion : "Unknown",
  status.ok ? status.latestVersion : "Unknown",
  formatNativeHostUpdateDateTime(status.checkedAt),
  formatNativeHostUpdateDateTime(status.nextCheckAt)
);
```

- [ ] **Step 7: Apply button busy states**

In `checkNativeHostUpdate`, wrap the request with:

```ts
setNativeHostUpdateChecking(true);
setNativeHostUpdateStatus("Checking for updates...");
setNativeHostUpdateApplyEnabled(false);

try {
  // existing sendMessage logic
} finally {
  setNativeHostUpdateChecking(false);
}
```

In `applyNativeHostUpdate`, before sending:

```ts
setNativeHostUpdateApplying(true);
setNativeHostUpdateStatus("Updating native host...");
```

After every response path, make sure `setNativeHostUpdateApplying(false)` runs in a `finally` block.

- [ ] **Step 8: Run guard and typecheck**

Run: `pnpm native-host-update:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/options.html src/options/options.css src/options/main.ts scripts/native-host-update-check.mjs
git commit -m "feat: show native host update metadata in options"
```

---

### Task 6: Keep Popup Compact And Update Fake Statuses

**Files:**
- Modify: `src/popup/main.ts`
- Modify: `scripts/popup-options-open-check.mjs`
- Test: `scripts/popup-options-open-check.mjs`

- [ ] **Step 1: Update fake stored status shape**

In `scripts/popup-options-open-check.mjs`, add the new required fields to the fake manual-update status:

```js
checkedAt: Date.now(),
nextCheckAt: Date.now() + 60 * 60 * 1000,
failureCount: 1,
lastErrorCode: "NATIVE_HOST_UPDATE_REQUIRED",
```

Keep `manualUpdateRequired: true`.

- [ ] **Step 2: Make Popup warning copy route to Options for non-manual updates**

In `src/popup/main.ts`, replace the attention branch with:

```ts
if (nativeHostUpdateNeedsAttention(updateStatus)) {
  const message = formatNativeHostUpdateStatusForUser(updateStatus);
  const detail =
    updateStatus?.ok && updateStatus.updateAvailable
      ? `${message.detail} Open Options for details.`
      : message.detail;
  setStatus(message.title, detail, "warning");
  return;
}
```

- [ ] **Step 3: Run popup/options check**

Run: `pnpm popup-options:check`

Expected: PASS with `popup-options-open-check: ok`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/popup/main.ts scripts/popup-options-open-check.mjs
git commit -m "feat: keep popup native update guidance compact"
```

---

### Task 7: Strengthen Native Helper Update Tests If Needed

**Files:**
- Modify: `native-helper/src/update.rs`
- Test: `native-helper/src/update.rs`

- [ ] **Step 1: Add missing release asset test**

In the `#[cfg(test)] mod tests` block in `native-helper/src/update.rs`, add:

```rust
#[test]
fn check_update_ignores_releases_without_required_assets() {
    let temp = tempdir().unwrap();
    let releases_path = temp.path().join("releases.json");
    fs::write(
        &releases_path,
        r#"[
          {"tag_name":"v9.9.9","prerelease":false,"draft":false,"html_url":"https://example.invalid/bad","assets":[{"name":"install-macos-native-host.sh"}]},
          {"tag_name":"v0.2.4","prerelease":false,"draft":false,"html_url":"https://example.invalid/good","assets":[{"name":"install-macos-native-host.sh"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-macos-arm64"}]}
        ]"#,
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
        releases_path.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
        "arm64".to_string(),
    );
    env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

    let status = check_update(&env, "0.2.3").unwrap();

    assert_eq!(status.latest_version, "0.2.4");
    assert_eq!(status.release_url, "https://example.invalid/good");
}
```

- [ ] **Step 2: Run helper tests**

Run: `pnpm helper:test`

Expected: PASS.

- [ ] **Step 3: Commit Task 7**

```bash
git add native-helper/src/update.rs
git commit -m "test: cover native host update asset filtering"
```

---

### Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run targeted checks**

Run: `pnpm native-host-update:check`

Expected: PASS with `native-host-update-check: ok`.

Run: `pnpm popup-options:check`

Expected: PASS with `popup-options-open-check: ok`.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm helper:test`

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `pnpm verify`

Expected: PASS. If runtime or environment prevents full verification, record the exact failing command and reason before final handoff.

- [ ] **Step 3: Inspect final diff**

Run: `git status --short`

Expected: no uncommitted changes except intentional documentation or generated files.

Run: `git log --oneline -8`

Expected: recent commits show the task commits from this plan.

---

## Self-Review

Spec coverage:

- Approval-based update policy is preserved by keeping install behind `Update Native Host`.
- Required metadata is covered in Tasks 1 and 2.
- Check/apply failure separation is covered in Tasks 1, 3, and 4.
- `nextCheckAt` as a lower bound is covered in Tasks 1 and 5.
- Post-install reconnect failure is covered in Task 4.
- Options metadata and button state UX are covered in Task 5.
- Popup compact guidance is covered in Task 6.
- Release asset filtering and existing installer behavior are protected by Task 7 and final verification.

Placeholder scan:

- This plan intentionally contains no unresolved placeholder markers or open-ended implementation steps.

Type consistency:

- The plan uses `NativeHostUpdateStoredStatus`, `NativeHostUpdateMetadata`, and `NativeHostUpdateStoredErrorCode` consistently.
- The helper names introduced in Task 1 are reused unchanged in later tasks.
