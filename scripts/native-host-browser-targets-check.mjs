import { strict as assert } from "node:assert";
import {
  BROWSER_TARGET_IDS,
  getNativeHostBrowserTargets,
  getWindowsRegistryViews,
  normalizeBrowserSelection
} from "./native-host-browser-targets.mjs";

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
assert.throws(() => normalizeBrowserSelection("firefox"), /Unsupported browser target/);

const macTargets = getNativeHostBrowserTargets("darwin", "/Users/tester");
assert.equal(macTargets.length, BROWSER_TARGET_IDS.length);
assert(macTargets.every((target) => target.kind === "manifest"));
assert(macTargets.some((target) => target.id === "edge" && target.manifestDir.endsWith("Microsoft Edge/NativeMessagingHosts")));
assert(macTargets.some((target) => target.id === "atlas" && target.support === "declared-only"));

const linuxTargets = getNativeHostBrowserTargets("linux", "/home/tester");
assert.equal(linuxTargets.length, BROWSER_TARGET_IDS.length);
assert(linuxTargets.every((target) => target.kind === "manifest"));
assert(linuxTargets.some((target) => target.id === "brave" && target.manifestDir.endsWith(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts")));

const windowsTargets = getNativeHostBrowserTargets("win32", "C:\\Users\\tester");
assert.equal(windowsTargets.length, BROWSER_TARGET_IDS.length);
assert(windowsTargets.every((target) => target.kind === "windows-registry"));
assert(windowsTargets.some((target) => target.id === "edge" && target.registryKey === "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.monklabs.hover_trans_port"));
assert.deepEqual(getWindowsRegistryViews(), ["/reg:32", "/reg:64"]);

console.log("native-host-browser-targets-check: browser targets are valid.");
