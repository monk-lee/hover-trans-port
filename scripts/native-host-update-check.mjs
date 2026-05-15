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

const manifest = JSON.parse(readText("public/manifest.json"));

if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes("alarms")) {
  throw new Error("public/manifest.json permissions must include alarms");
}

const checks = [
  {
    path: "src/shared/nativeHostUpdate.ts",
    needles: [
      "MANUAL_NATIVE_HOST_UPDATE_COMMAND",
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
      "checkNativeHostUpdateStatus",
      "updateNativeHost",
      'case "INVALID_MESSAGE"'
    ]
  },
  {
    path: "src/background/service-worker.ts",
    needles: [
      "chrome.alarms.create",
      "chrome.action.setBadgeText",
      "native-host-update-check",
      "hoverTransPortNativeHostUpdate",
      "maybeRefreshNativeHostUpdateStatus",
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

const serviceWorkerText = readText("src/background/service-worker.ts");
const nativeClientText = readText("src/background/nativeClient.ts");
const optionsHtml = readText("src/options.html");
const optionsMain = readText("src/options/main.ts");
const popupMain = readText("src/popup/main.ts");

assertMatches(
  serviceWorkerText,
  /chrome\.alarms\.onAlarm[\s\S]*shouldAutoCheckNativeHostUpdate[\s\S]*refreshNativeHostUpdateStatus/u,
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
  /function shouldRefreshNativeHostUpdateStatus[\s\S]*manualUpdateRequired[\s\S]*NATIVE_HOST_UPDATE_REQUIRED/u,
  "src/background/service-worker.ts",
  "manual update required status refreshes on extension use"
);
assertMatches(
  serviceWorkerText,
  /function syncNativeHostUpdateBadge[\s\S]*nativeHostUpdateNeedsAttention[\s\S]*chrome\.action\.setBadgeText/u,
  "src/background/service-worker.ts",
  "native host update attention badge"
);
assertMatches(
  serviceWorkerText,
  /if \(message\.type === "TRANSLATE_CURRENT_TARGET"\)[\s\S]*scheduleNativeHostUpdateStatusRefresh[\s\S]*translateWithNativeHost/u,
  "src/background/service-worker.ts",
  "opportunistic update check when translation is used"
);
assertMatches(
  serviceWorkerText,
  /if \(message\.type === "UPDATE_NATIVE_HOST"\)[\s\S]*sendResponse[\s\S]*refreshPostNativeHostUpdateStatus[\s\S]*return true;/u,
  "src/background/service-worker.ts",
  "async UPDATE_NATIVE_HOST response pattern"
);
assertMatches(
  serviceWorkerText,
  /refreshPostNativeHostUpdateStatus[\s\S]*try[\s\S]*(checkNativeHost|refreshNativeHostUpdateStatus)[\s\S]*catch/u,
  "src/background/service-worker.ts",
  "best-effort post-update try/catch"
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
  optionsMain,
  "formatNativeHostUpdateStatusForUser",
  "Options formats manual update guidance"
);
assertIncludes(
  popupMain,
  "formatNativeHostUpdateStatusForUser",
  "Popup formats manual update guidance"
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
