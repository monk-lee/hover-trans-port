import { readFileSync } from "node:fs";

function readText(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(text, needle, path) {
  if (!text.includes(needle)) {
    throw new Error(`${path} must include ${needle}`);
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
      'type: "NATIVE_HOST_UPDATE_STATUS"'
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
    needles: ["checkNativeHostUpdateStatus", "updateNativeHost"]
  },
  {
    path: "src/background/service-worker.ts",
    needles: [
      "chrome.alarms.create",
      "native-host-update-check",
      "hoverTransPortNativeHostUpdate"
    ]
  }
];

for (const check of checks) {
  const text = readText(check.path);

  for (const needle of check.needles) {
    assertIncludes(text, needle, check.path);
  }
}

console.log("native-host-update-check: ok");
