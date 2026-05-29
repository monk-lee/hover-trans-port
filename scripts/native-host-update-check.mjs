import { readFileSync } from "node:fs";

function readText(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(text, needle, path) {
  if (!text.includes(needle)) {
    throw new Error(`${path} must include ${needle}`);
  }
}

function assertMatches(text, pattern, path, message) {
  if (!pattern.test(text)) {
    throw new Error(`${path} must include ${message}`);
  }
}

function extractBlock(text, startNeedle, path) {
  const startIndex = text.indexOf(startNeedle);
  if (startIndex === -1) {
    throw new Error(`${path} must include ${startNeedle}`);
  }

  const openBraceIndex = text.indexOf("{", startIndex);
  if (openBraceIndex === -1) {
    throw new Error(`${path} must include block for ${startNeedle}`);
  }

  let depth = 0;
  for (let index = openBraceIndex; index < text.length; index += 1) {
    const char = text[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error(`${path} must include complete block for ${startNeedle}`);
}

const manifest = JSON.parse(readText("public/manifest.json"));

if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes("alarms")) {
  throw new Error("public/manifest.json permissions must include alarms");
}

const checks = [
  {
    path: "src/shared/nativeHostUpdate.ts",
    needles: [
      "MANUAL_NATIVE_HOST_UPDATE_COMMAND",
      "NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS",
      "NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS",
      "NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS",
      "createNativeHostUpdateMetadata",
      "getNativeHostUpdateNextCheckAt",
      "isNativeHostUpdateRefreshDue",
      "formatNativeHostUpdateStatusForUser",
      "nativeHostUpdateNeedsAttention"
    ]
  },
  {
    path: "src/shared/nativeProtocol.ts",
    needles: [
      'type: "NATIVE_HOST_UPDATE_STATUS"',
      'type: "NATIVE_HOST_UPDATE_RESULT"',
      '"UPDATE_CHECK_FAILED"'
    ]
  },
  {
    path: "src/shared/messages.ts",
    needles: [
      'type: "CHECK_NATIVE_HOST_UPDATE"',
      'type: "UPDATE_NATIVE_HOST"',
      'type: "NATIVE_HOST_UPDATE_STATUS"',
      "nextCheckAt",
      "failureCount",
      "lastErrorCode",
      '"INVALID_MESSAGE"'
    ]
  },
  {
    path: "src/shared/options.ts",
    needles: [
      "DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK",
      "normalizeNativeHostUpdateAutoCheck"
    ]
  },
  {
    path: "src/background/nativeClient.ts",
    needles: [
      "NATIVE_HOST_UPDATE_STATUS_TIMEOUT_MS",
      "createNativeHostUpdateMetadata",
      "previousStatus?: NativeHostUpdateStoredStatus",
      "checkNativeHostUpdateStatus",
      "updateNativeHost",
      'case "INVALID_MESSAGE"'
    ]
  },
  {
    path: "native-helper/src/update.rs",
    needles: [
      "fn required_release_assets",
      "fn supported_release_assets",
      "let _ = supported_release_assets(env)?;",
      '"UPDATE_UNSUPPORTED_PLATFORM"',
      '("macos", "arm64") | ("macos", "aarch64")',
      '("linux", "arm64") | ("linux", "aarch64")',
      '("linux", "x86_64")',
      '("windows", "arm64") | ("windows", "aarch64")',
      '("windows", "x86_64")',
      '"install.sh"',
      '"install.ps1"',
      '"install-windows-native-host.ps1"',
      '"install-macos-native-host.sh"',
      '"hover-trans-port-helper-linux-arm64"',
      '"hover-trans-port-helper-linux-x64"',
      '"hover-trans-port-helper-windows-arm64.exe"',
      '"hover-trans-port-helper-windows-x64.exe"',
      "fn default_curl_path",
      '"SystemRoot"',
      '"System32"',
      '"curl.exe"',
      "fn active_metadata_path",
      '"native-hosts"',
      "fn install_root",
      '"LOCALAPPDATA"',
      '".local"',
      '"share"',
      "fn update_args",
      '"-Command"',
      '"-ReleaseTag"',
      '"-HostVersion"',
      '"-Json"',
      '"--release-tag"',
      '"--host-version"',
      '"--json"'
    ]
  },
  {
    path: "native-helper/tests/bridge_tests.rs",
    needles: [
      "native_host_update_invokes_windows_updater_with_powershell_args",
      'fs::write(install_root.join("current"), "0.2.3\\n")'
    ]
  },
  {
    path: "src/background/service-worker.ts",
    needles: [
      "chrome.alarms.create",
      "chrome.action.setBadgeText",
      "native-host-update-check",
      "hoverTransPortNativeHostUpdate",
      "nativeHostUpdateStatusWriteQueue",
      "enqueueNativeHostUpdateStatusWrite",
      "writeNativeHostUpdateStatus",
      "hasNativeHostUpdateSchedule",
      "isNativeHostUpdateRefreshDue",
      "maybeRefreshNativeHostUpdateStatus",
      "previousStatus",
      "nextCheckAt",
      "shouldRefreshNativeHostUpdateStatus",
      "scheduleNativeHostUpdateStatusRefresh",
      "shouldAutoCheckNativeHostUpdate",
      "chrome.storage.onChanged",
      "refreshPostNativeHostUpdateStatus",
      "return true;"
    ]
  }
];

for (const check of checks) {
  const text = readText(check.path);

  for (const needle of check.needles) {
    assertIncludes(text, needle, check.path);
  }
}

assertIncludes(
  readText("src/shared/nativeHostUpdate.ts"),
  "getManualNativeHostUpdateCommand",
  "manual update command must be platform-aware"
);
assertMatches(
  readText("src/shared/nativeHostUpdate.ts"),
  /formatNativeHostUpdateStatusForUser\(\s*status: NativeHostUpdateStoredStatus,\s*platform\?: string[\s\S]*getManualNativeHostUpdateCommand\(platform\)/u,
  "src/shared/nativeHostUpdate.ts",
  "manual update formatter routes through platform-aware command"
);
assertIncludes(
  readText("docs/native-host-install.md"),
  "install.ps1",
  "docs must include Windows PowerShell install"
);
assertIncludes(
  readText("docs/native-host-install.md"),
  "install.sh",
  "docs must include Unix install"
);
assertIncludes(
  readText("docs/native-host-install.md"),
  "~/.local/share/hover-trans-port",
  "docs must include actual Linux install root"
);
assertIncludes(
  readText("docs/native-host-install.md"),
  "$env:LOCALAPPDATA\\Hover Trans Port",
  "docs must include Windows install root"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "install.sh",
  "release checklist must include Unix installer"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "install.ps1",
  "release checklist must include Windows PowerShell installer"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "hover-trans-port-native-host-linux-0.2.14.tar.gz",
  "release checklist must include Linux inspect-first tarball"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "hover-trans-port-native-host-windows-0.2.14.zip",
  "release checklist must include Windows inspect-first zip"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "~/Library/Application Support/Hover Trans Port/current",
  "release checklist must include actual macOS install root"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "~/.local/share/hover-trans-port/current",
  "release checklist must include actual Linux install root"
);
assertIncludes(
  readText("docs/open-source-release-checklist.md"),
  "$env:LOCALAPPDATA\\Hover Trans Port\\current",
  "release checklist must include Windows install root"
);

const serviceWorkerText = readText("src/background/service-worker.ts");
const alarmListenerText = extractBlock(
  serviceWorkerText,
  "chrome.alarms.onAlarm.addListener",
  "src/background/service-worker.ts"
);
const nativeClientText = readText("src/background/nativeClient.ts");
const optionsHtml = readText("src/options.html");
const optionsMain = readText("src/options/main.ts");
const popupMain = readText("src/popup/main.ts");

assertMatches(
  alarmListenerText,
  /shouldAutoCheckNativeHostUpdate[\s\S]*maybeRefreshNativeHostUpdateStatus/u,
  "src/background/service-worker.ts",
  "auto-check gating inside chrome.alarms.onAlarm"
);
assertMatches(
  serviceWorkerText,
  /chrome\.storage\.onChanged[\s\S]*ensureNativeHostUpdateAlarm/u,
  "src/background/service-worker.ts",
  "alarm rescheduling from chrome.storage.onChanged"
);
assertMatches(
  serviceWorkerText,
  /function shouldRefreshNativeHostUpdateStatus[\s\S]*hasNativeHostUpdateSchedule\(status\)[\s\S]*isNativeHostUpdateRefreshDue\(status\)/u,
  "src/background/service-worker.ts",
  "native host update refresh uses nextCheckAt backoff"
);
assertMatches(
  serviceWorkerText,
  /function syncNativeHostUpdateBadge[\s\S]*nativeHostUpdateNeedsAttention[\s\S]*chrome\.action\.setBadgeText/u,
  "src/background/service-worker.ts",
  "native host update attention badge"
);
assertMatches(
  serviceWorkerText,
  /function enqueueNativeHostUpdateStatusWrite[\s\S]*nativeHostUpdateStatusWriteQueue\.then\(write, write\)[\s\S]*nativeHostUpdateStatusWriteQueue = queuedWrite\.catch/u,
  "src/background/service-worker.ts",
  "native host update status writes are queued"
);
assertMatches(
  serviceWorkerText,
  /async function storeNativeHostUpdateStatus[\s\S]*enqueueNativeHostUpdateStatusWrite[\s\S]*currentStatus\.checkedAt > status\.checkedAt[\s\S]*writeNativeHostUpdateStatus\(status\)/u,
  "src/background/service-worker.ts",
  "native host update status store uses queued monotonic write"
);
assertMatches(
  serviceWorkerText,
  /if \(message\.type === "TRANSLATE_CURRENT_TARGET"\)[\s\S]*scheduleNativeHostUpdateStatusRefresh[\s\S]*translateWithNativeHost/u,
  "src/background/service-worker.ts",
  "opportunistic update check when translation is used"
);
assertMatches(
  serviceWorkerText,
  /if \(message\.type === "UPDATE_NATIVE_HOST"\)[\s\S]*sendResponse[\s\S]*if \(result\.ok\)[\s\S]*refreshPostNativeHostUpdateStatus\(message\.requestId\)[\s\S]*return true;/u,
  "src/background/service-worker.ts",
  "async UPDATE_NATIVE_HOST response pattern only verifies successful updates"
);
assertMatches(
  serviceWorkerText,
  /refreshPostNativeHostUpdateStatus[\s\S]*try[\s\S]*(checkNativeHost|refreshNativeHostUpdateStatus)[\s\S]*catch/u,
  "src/background/service-worker.ts",
  "best-effort post-update try/catch"
);
assertMatches(
  serviceWorkerText,
  /refreshPostNativeHostUpdateStatus[\s\S]*const hostStatus = await checkNativeHost[\s\S]*if \(!hostStatus\.ok\)[\s\S]*storeNativeHostUpdateReconnectFailedStatus\(previousStatus\)[\s\S]*return;/u,
  "src/background/service-worker.ts",
  "post-update host status ok result is checked before update status refresh"
);
assertMatches(
  serviceWorkerText,
  /refreshPostNativeHostUpdateStatus[\s\S]*const updateStatus = await checkNativeHostUpdateStatus\(\s*`\$\{requestId\}:status`,\s*previousStatus\s*\)[\s\S]*updateStatus\.error === "NATIVE_HOST_UNAVAILABLE"[\s\S]*storeNativeHostUpdateReconnectFailedStatus\(previousStatus\)[\s\S]*storeNativeHostUpdateStatus\(updateStatus\)/u,
  "src/background/service-worker.ts",
  "post-update unavailable status is stored as reconnect failure"
);
assertMatches(
  serviceWorkerText,
  /storeNativeHostUpdateReconnectFailedStatus[\s\S]*enqueueNativeHostUpdateStatusWrite[\s\S]*currentStatus[\s\S]*currentStatus\.checkedAt > previousStatus\.checkedAt[\s\S]*writeNativeHostUpdateStatus\(\s*createNativeHostUpdateReconnectFailedStatus\(previousStatus\)\s*\)/u,
  "src/background/service-worker.ts",
  "stale reconnect failure writes are skipped inside the write queue"
);
assertMatches(
  serviceWorkerText,
  /function createNativeHostUpdateReconnectFailedStatus[\s\S]*UPDATE_RECONNECT_FAILED[\s\S]*async function storeNativeHostUpdateReconnectFailedStatus/u,
  "src/background/service-worker.ts",
  "post-update reconnect failure is stored"
);
assertMatches(
  nativeClientText,
  /checkNativeHostUpdateStatus[\s\S]*sendStatusCheckMessageWithRetry\(\s*request,\s*NATIVE_HOST_UPDATE_STATUS_TIMEOUT_MS\s*\)/u,
  "src/background/nativeClient.ts",
  "native host update status uses the update status timeout"
);
assertMatches(
  nativeClientText,
  /checkNativeHostUpdateStatus[\s\S]*response\?\.type === "ERROR"[\s\S]*response\.error === "INVALID_MESSAGE"[\s\S]*error: "INVALID_MESSAGE"[\s\S]*retryable: false[\s\S]*updateNativeHost/u,
  "src/background/nativeClient.ts",
  "generic ERROR INVALID_MESSAGE handling in update status path"
);
assertMatches(
  nativeClientText,
  /updateNativeHost[\s\S]*response\?\.type === "ERROR"[\s\S]*response\.error === "INVALID_MESSAGE"[\s\S]*error: "INVALID_MESSAGE"[\s\S]*retryable: false/u,
  "src/background/nativeClient.ts",
  "generic ERROR INVALID_MESSAGE handling in update apply path"
);
assertMatches(
  nativeClientText,
  /checkNativeHostUpdateStatus\(\s*requestId: string,\s*previousStatus\?: NativeHostUpdateStoredStatus\s*\)[\s\S]*createNativeHostUpdateMetadata/u,
  "src/background/nativeClient.ts",
  "update status metadata is created in native client"
);

assertIncludes(
  optionsHtml,
  'id="native-host-update-auto-check"',
  "Options auto-check toggle"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-status"',
  "Options update status"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-check"',
  "Options check update button"
);
assertIncludes(
  optionsHtml,
  'id="native-host-update-apply"',
  "Options update apply button"
);
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
assertMatches(
  optionsMain,
  /formatNativeHostUpdateStatusForUser\(\s*status,\s*navigator\.platform\s*\)/u,
  "src/options/main.ts",
  "Options formats manual update guidance with browser platform"
);
assertIncludes(
  optionsMain,
  "setNativeHostUpdateChecking",
  "Options check button busy state"
);
assertIncludes(
  optionsMain,
  "setNativeHostUpdateApplying",
  "Options apply button busy state"
);
assertIncludes(
  optionsMain,
  "formatNativeHostUpdateDateTime",
  "Options formats update timestamps"
);
assertMatches(
  popupMain,
  /formatNativeHostUpdateStatusForUser\(\s*updateStatus,\s*navigator\.platform\s*\)/u,
  "src/popup/main.ts",
  "Popup formats manual update guidance with browser platform"
);
assertIncludes(
  optionsMain,
  "loadNativeHostUpdateStatus",
  "Options update status loader"
);
assertIncludes(
  optionsMain,
  "checkNativeHostUpdate",
  "Options update status checker"
);
assertIncludes(
  optionsMain,
  "applyNativeHostUpdate",
  "Options update applier"
);

console.log("native-host-update-check: ok");
