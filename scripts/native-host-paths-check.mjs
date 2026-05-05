import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  NATIVE_HOST_VERSION,
  getActiveNativeHostLinkPath,
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

try {
  const env = {
    HOVER_TRANS_PORT_INSTALL_ROOT: installRoot
  };

  assert.equal(NATIVE_HOST_VERSION, "0.1.0");
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
