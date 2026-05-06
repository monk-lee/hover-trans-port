import { existsSync, rmSync } from "node:fs";
import {
  getBrowserNativeHostManifestPaths,
  getLegacyNativeHostLauncherPath,
  getNativeHostInstallRoot
} from "./native-host-paths.mjs";

const manifestPaths = getBrowserNativeHostManifestPaths();
const installRoot = getNativeHostInstallRoot();
const legacyLauncherPath = getLegacyNativeHostLauncherPath();

for (const manifestPath of manifestPaths) {
  if (existsSync(manifestPath)) {
    rmSync(manifestPath);
    console.log(`native-host uninstall: removed ${manifestPath}`);
  } else {
    console.log(`native-host uninstall: no manifest at ${manifestPath}`);
  }
}

if (existsSync(installRoot)) {
  rmSync(installRoot, { recursive: true, force: true });
  console.log(`native-host uninstall: removed ${installRoot}`);
} else {
  console.log(`native-host uninstall: no install root at ${installRoot}`);
}

if (existsSync(legacyLauncherPath)) {
  rmSync(legacyLauncherPath);
  console.log(`native-host uninstall: removed legacy launcher ${legacyLauncherPath}`);
} else {
  console.log(`native-host uninstall: no legacy launcher at ${legacyLauncherPath}`);
}
