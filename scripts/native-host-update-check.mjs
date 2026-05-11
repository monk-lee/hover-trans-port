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
      "checkNativeHostUpdateStatus",
      "updateNativeHost",
      'case "INVALID_MESSAGE"'
    ]
  },
  {
    path: "src/background/service-worker.ts",
    needles: [
      "chrome.alarms.create",
      "native-host-update-check",
      "hoverTransPortNativeHostUpdate",
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

console.log("native-host-update-check: ok");
