import { strict as assert } from "node:assert";
import {
  BROWSER_TARGET_IDS,
  getNativeHostBrowserTargets,
  getWindowsRegistryViews,
  normalizeBrowserSelection
} from "./native-host-browser-targets.mjs";

const TARGET_CONTRACTS = {
  chrome: {
    label: "Google Chrome",
    support: "official-doc-backed",
    macDir: "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/google-chrome/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\chrome",
    registryKey: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  chromium: {
    label: "Chromium",
    support: "official-doc-backed",
    macDir: "/Users/tester/Library/Application Support/Chromium/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/chromium/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\chromium",
    registryKey: "HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  edge: {
    label: "Microsoft Edge",
    support: "official-doc-backed",
    macDir: "/Users/tester/Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/microsoft-edge/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\edge",
    registryKey: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  brave: {
    label: "Brave",
    support: "repo-reference-backed",
    macDir: "/Users/tester/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\brave",
    registryKey: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  whale: {
    label: "Naver Whale",
    support: "declared-only",
    macDir: "/Users/tester/Library/Application Support/Naver/Whale/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/naver-whale/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\whale",
    registryKey: "HKCU\\Software\\Naver\\Whale\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  atlas: {
    label: "ChatGPT Atlas",
    support: "declared-only",
    macDir: "/Users/tester/Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/chatgpt-atlas/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\atlas",
    registryKey: "HKCU\\Software\\OpenAI\\ChatGPT Atlas\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  },
  vivaldi: {
    label: "Vivaldi",
    support: "declared-only",
    macDir: "/Users/tester/Library/Application Support/Vivaldi/NativeMessagingHosts",
    linuxDir: "/home/tester/.config/vivaldi/NativeMessagingHosts",
    windowsDir: "C:\\Users\\tester\\AppData\\Local\\Hover Trans Port\\NativeMessagingHosts\\vivaldi",
    registryKey: "HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\com.monklabs.hover_trans_port"
  }
};

assert.deepEqual(BROWSER_TARGET_IDS, [
  "chrome",
  "chromium",
  "edge",
  "brave",
  "whale",
  "atlas",
  "vivaldi"
]);

assert.deepEqual(normalizeBrowserSelection(undefined), BROWSER_TARGET_IDS);
assert.deepEqual(normalizeBrowserSelection("all"), BROWSER_TARGET_IDS);
assert.deepEqual(normalizeBrowserSelection("ALL"), BROWSER_TARGET_IDS);
assert.deepEqual(normalizeBrowserSelection("   "), BROWSER_TARGET_IDS);
assert.deepEqual(normalizeBrowserSelection("chrome,edge"), ["chrome", "edge"]);
assert.deepEqual(normalizeBrowserSelection("Chrome, EDGE"), ["chrome", "edge"]);
assert.deepEqual(normalizeBrowserSelection("chrome,edge,chrome"), ["chrome", "edge"]);
assert.throws(() => normalizeBrowserSelection(","), /No browser targets selected/);
assert.throws(() => normalizeBrowserSelection(" , , "), /No browser targets selected/);
assert.throws(() => normalizeBrowserSelection("firefox"), /Unsupported browser target/);

assert.throws(
  () => getNativeHostBrowserTargets("freebsd", "/home/tester"),
  /Unsupported native host install platform/
);

assert.deepEqual(
  getNativeHostBrowserTargets("darwin", "/Users/tester"),
  BROWSER_TARGET_IDS.map((id) => expectedManifestTarget(id, "macDir"))
);

assert.deepEqual(
  getNativeHostBrowserTargets("linux", "/home/tester"),
  BROWSER_TARGET_IDS.map((id) => expectedManifestTarget(id, "linuxDir"))
);

assert.deepEqual(
  getNativeHostBrowserTargets("win32", "C:\\Users\\tester"),
  BROWSER_TARGET_IDS.map((id) => expectedWindowsTarget(id))
);
assert.deepEqual(getWindowsRegistryViews(), ["/reg:32", "/reg:64"]);

console.log("native-host-browser-targets-check: browser targets are valid.");

function expectedManifestTarget(id, dirKey) {
  const contract = TARGET_CONTRACTS[id];
  return {
    id,
    label: contract.label,
    kind: "manifest",
    support: contract.support,
    manifestDir: contract[dirKey]
  };
}

function expectedWindowsTarget(id) {
  const contract = TARGET_CONTRACTS[id];
  return {
    id,
    label: contract.label,
    kind: "windows-registry",
    support: contract.support,
    manifestDir: contract.windowsDir,
    registryKey: contract.registryKey
  };
}
