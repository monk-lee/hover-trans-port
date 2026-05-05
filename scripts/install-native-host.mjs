import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { renderNativeHostLauncher } from "./native-host-launcher.mjs";
import {
  NATIVE_HOST_VERSION,
  getActiveNativeHostLinkPath,
  getCompiledNativeHostPath,
  getExtensionIdFromManifestKey,
  getInstalledNativeHostVersionDir,
  getLegacyNativeHostLauncherPath,
  getNativeHostInstallRoot,
  getNativeHostLauncherPath,
  getNativeHostManifestPath,
  getRepoNativeHostScriptPath,
  renderNativeHostManifest,
  repoRoot
} from "./native-host-paths.mjs";

const extensionManifest = JSON.parse(
  readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")
);

if (!extensionManifest.key) {
  throw new Error("public/manifest.json must contain a stable dev key.");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function copyNativeHostToVersionDir(versionDir) {
  const sourceDir = resolve(repoRoot, "native-host");
  const stagingDir = `${versionDir}.staging`;
  const backupDir = `${versionDir}.backup`;

  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
  mkdirSync(dirname(versionDir), { recursive: true });
  cpSync(sourceDir, stagingDir, {
    recursive: true,
    filter(source) {
      return !source.endsWith(".DS_Store");
    }
  });
  writeJson(resolve(stagingDir, "metadata.json"), {
    hostVersion: NATIVE_HOST_VERSION,
    protocolVersion: 1,
    source: "developer-install",
    repoRoot
  });

  const hadExistingVersion = existsSync(versionDir);
  try {
    if (hadExistingVersion) {
      renameSync(versionDir, backupDir);
    }

    try {
      renameSync(stagingDir, versionDir);
    } catch (error) {
      if (
        hadExistingVersion &&
        existsSync(backupDir) &&
        !existsSync(versionDir)
      ) {
        renameSync(backupDir, versionDir);
      }
      throw error;
    }

    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function pointCurrentAtVersion(currentPath, versionDir) {
  const nextPath = `${currentPath}.next`;
  rmSync(nextPath, { recursive: true, force: true });
  symlinkSync(versionDir, nextPath, "dir");
  renameSync(nextPath, currentPath);
}

const extensionId = getExtensionIdFromManifestKey(extensionManifest.key);
const manifestPath = getNativeHostManifestPath();
const installRoot = getNativeHostInstallRoot();
const versionDir = getInstalledNativeHostVersionDir(NATIVE_HOST_VERSION);
const currentPath = getActiveNativeHostLinkPath();
const launcherPath = getNativeHostLauncherPath();
const legacyLauncherPath = getLegacyNativeHostLauncherPath();
const compiledHostPath = getCompiledNativeHostPath();
const useNodeHostFallback = process.env.HOVER_TRANS_PORT_USE_NODE_HOST === "1";
const nativeManifest = renderNativeHostManifest({
  extensionId,
  hostPath: useNodeHostFallback ? launcherPath : compiledHostPath
});

if (!Array.isArray(nativeManifest.allowed_origins)) {
  throw new Error("Native host manifest must contain allowed_origins.");
}

if (useNodeHostFallback) {
  mkdirSync(installRoot, { recursive: true });
  copyNativeHostToVersionDir(versionDir);
  pointCurrentAtVersion(currentPath, versionDir);
  writeFileSync(
    launcherPath,
    renderNativeHostLauncher({ nodePath: process.execPath })
  );
  chmodSync(launcherPath, 0o755);
  rmSync(legacyLauncherPath, { force: true });
} else if (!existsSync(compiledHostPath)) {
  throw new Error(
    `Compiled native helper is missing at ${compiledHostPath}. Run pnpm helper:build:release first.`
  );
}

mkdirSync(dirname(manifestPath), { recursive: true });
writeJson(manifestPath, nativeManifest);

console.log(`native-host install: ${manifestPath}`);
console.log(`native-host extension origin: chrome-extension://${extensionId}/`);
if (useNodeHostFallback) {
  console.log(`native-host mode: node fallback`);
  console.log(`native-host install root: ${installRoot}`);
  console.log(`native-host version: ${NATIVE_HOST_VERSION}`);
  console.log(`native-host current: ${currentPath}`);
  console.log(`native-host launcher: ${launcherPath}`);
  console.log(`native-host source script: ${getRepoNativeHostScriptPath()}`);
} else {
  console.log(`native-host mode: compiled helper`);
  console.log(`native-host helper: ${compiledHostPath}`);
}
