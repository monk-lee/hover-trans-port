import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  NATIVE_HOST_NAME,
  NATIVE_HOST_VERSION,
  getActiveNativeHostLinkPath,
  getBrowserNativeHostManifestPaths,
  getChromeNativeHostsDir,
  getCompiledNativeHostPath,
  getInstalledNativeHostVersionDir,
  getNativeHostInstallRoot,
  getNativeHostLauncherPath,
  getNativeHostManifestPath,
  getRepoNativeHostScriptPath
} from "./native-host-paths.mjs";
import { renderNativeHostLauncher } from "./native-host-launcher.mjs";

const installRoot = mkdtempSync(join(tmpdir(), "hover-trans-port-install-"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifestJson = JSON.parse(readFileSync("public/manifest.json", "utf8"));
const cargoToml = readFileSync("native-helper/Cargo.toml", "utf8");
const nativeMessages = readFileSync("native-helper/src/messages.rs", "utf8");
const nativeProtocol = readFileSync("src/shared/nativeProtocol.ts", "utf8");
const scriptInstaller = readFileSync("scripts/install-macos-native-host.sh", "utf8");
const releaseAssetBuilder = readFileSync(
  "scripts/build-macos-script-installer-release.sh",
  "utf8"
);

try {
  const env = {
    HOVER_TRANS_PORT_INSTALL_ROOT: installRoot
  };

  assert.equal(NATIVE_HOST_NAME, "com.monklabs.hover_trans_port");
  assert.equal(NATIVE_HOST_VERSION, "0.2.14");
  assert.equal(manifestJson.version, packageJson.version);
  assert.match(cargoToml, new RegExp(`^version = "${packageJson.version}"`, "m"));
  assert.match(
    nativeMessages,
    new RegExp(`NATIVE_HOST_VERSION: &str = "${packageJson.version}"`)
  );
  assert.match(
    nativeMessages,
    new RegExp(`NATIVE_BRIDGE_VERSION: &str = "${packageJson.version}-rust-helper"`)
  );
  assert.match(
    nativeProtocol,
    new RegExp(`NATIVE_HOST_VERSION = "${packageJson.version}"`)
  );
  assert.match(
    nativeProtocol,
    new RegExp(`NATIVE_BRIDGE_VERSION = "${packageJson.version}-rust-helper"`)
  );
  assert.match(
    scriptInstaller,
    new RegExp(`DEFAULT_HOST_VERSION="${packageJson.version}"`)
  );
  assert.match(
    releaseAssetBuilder,
    new RegExp(`HOST_VERSION="${packageJson.version}"`)
  );
  assert.equal(getNativeHostInstallRoot("darwin", env), installRoot);
  assert.equal(
    getInstalledNativeHostVersionDir(NATIVE_HOST_VERSION, "darwin", env),
    resolve(installRoot, "native-hosts", NATIVE_HOST_VERSION)
  );
  assert.equal(
    getActiveNativeHostLinkPath("darwin", env),
    resolve(installRoot, "current")
  );
  assert.equal(
    getNativeHostLauncherPath("darwin", env),
    resolve(installRoot, "launcher")
  );
  assert.equal(
    getChromeNativeHostsDir("darwin").endsWith(
      "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ),
    true
  );
  assert.equal(
    getNativeHostManifestPath("darwin").endsWith(
      "NativeMessagingHosts/com.monklabs.hover_trans_port.json"
    ),
    true
  );
  assert.deepEqual(
    getBrowserNativeHostManifestPaths("darwin").map((path) =>
      path
        .replace(`${process.env.HOME}/`, "")
        .replaceAll("\\", "/")
    ),
    [
      "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.monklabs.hover_trans_port.json",
      "Library/Application Support/Naver/Whale/NativeMessagingHosts/com.monklabs.hover_trans_port.json",
      "Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts/com.monklabs.hover_trans_port.json"
    ]
  );
  assert.equal(
    getRepoNativeHostScriptPath().endsWith("native-host/host.mjs"),
    true
  );
  assert.equal(
    getCompiledNativeHostPath().endsWith(
      "native-helper/target/release/hover-trans-port-helper"
    ),
    true
  );

  const launcher = renderNativeHostLauncher({
    nodePath: "/usr/local/bin/node"
  });
  assert.match(launcher, /^#!\/bin\/sh/);
  assert.match(launcher, /current\/host\.mjs/);
  assert.match(launcher, /exec '\/usr\/local\/bin\/node'/);

  console.log("native-host-paths-check: versioned paths are valid.");
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
