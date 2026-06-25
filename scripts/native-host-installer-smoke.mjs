#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const hostName = "com.monklabs.hover_trans_port";
const requestId = "native-host-installer-smoke";
const smokeVersion = packageJson.version;
const tempRoot = mkdtempSync(path.join(tmpdir(), "hover-trans-port-smoke-"));
const homeDir = path.join(tempRoot, "home");
const installRoot = path.join(tempRoot, "install-root");
const localAppData = path.join(tempRoot, "LocalAppData");
const smokeRegistryKey = `HKCU\\Software\\HoverTransPortSmoke\\NativeMessagingHosts\\${hostName}`;

function fail(message) {
  console.error(`native-host-installer-smoke: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    env: {
      ...process.env,
      ...options.env
    },
    input: options.input,
    shell: options.shell ?? false,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"]
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      [
        `${command} ${args.join(" ")} exited with ${result.status}`,
        result.stdout,
        result.stderr
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result;
}

function runOptional(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    env: {
      ...process.env,
      ...options.env
    },
    input: options.input,
    shell: options.shell ?? false,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"]
  });
}

function parseJsonOutput(result, description) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${description} did not return JSON: ${error.message}\n${result.stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function helperPath() {
  if (process.env.HOVER_TRANS_PORT_SMOKE_HELPER) {
    return path.resolve(process.env.HOVER_TRANS_PORT_SMOKE_HELPER);
  }

  return path.join(
    repoRoot,
    "native-helper",
    "target",
    "release",
    process.platform === "win32"
      ? "hover-trans-port-helper.exe"
      : "hover-trans-port-helper"
  );
}

function installerEnv() {
  if (process.platform === "win32") {
    return {
      LOCALAPPDATA: localAppData
    };
  }

  return {
    HOME: homeDir,
    HOVER_TRANS_PORT_INSTALL_ROOT: installRoot
  };
}

function installArgs(helper) {
  if (process.platform === "win32") {
    return [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(repoRoot, "scripts", "install-windows-native-host.ps1"),
      "install",
      "-HostVersion",
      smokeVersion,
      "-HelperSource",
      helper,
      "-Browser",
      "chrome",
      "-RegistryKey",
      smokeRegistryKey,
      "-Json"
    ];
  }

  return [
    path.join(repoRoot, "scripts", "install.sh"),
    "install",
    "--host-version",
    smokeVersion,
    "--helper-source",
    helper,
    "--json"
  ];
}

function statusArgs() {
  if (process.platform === "win32") {
    return [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(repoRoot, "scripts", "install-windows-native-host.ps1"),
      "status",
      "-Browser",
      "chrome",
      "-RegistryKey",
      smokeRegistryKey
    ];
  }

  return [path.join(repoRoot, "scripts", "install.sh"), "status"];
}

function uninstallArgs() {
  if (process.platform === "win32") {
    return [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(repoRoot, "scripts", "install-windows-native-host.ps1"),
      "uninstall",
      "-RegistryKey",
      smokeRegistryKey
    ];
  }

  return [path.join(repoRoot, "scripts", "install.sh"), "uninstall"];
}

function installerCommand() {
  return process.platform === "win32" ? "powershell.exe" : "bash";
}

function readManifest(manifestPath) {
  assert(existsSync(manifestPath), `manifest was not created: ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function launcherFromManifest(installResult) {
  assert(Array.isArray(installResult.manifests), "install result must list manifests");
  assert(installResult.manifests.length > 0, "install result must include a manifest");
  const manifest = readManifest(installResult.manifests[0]);
  assert(manifest.name === hostName, "manifest name should match native host");
  assert(manifest.type === "stdio", "manifest type should be stdio");
  assert(
    manifest.allowed_origins?.includes(
      "chrome-extension://mmbmjpmhmlkjknhcigafgplahdbicabe/"
    ),
    "manifest should include the extension origin"
  );
  assert(existsSync(manifest.path), `manifest launcher path does not exist: ${manifest.path}`);
  return manifest.path;
}

function nativeMessageFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function parseNativeMessageFrame(output) {
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  assert(buffer.length >= 4, "native host did not write a response frame");
  const length = buffer.readUInt32LE(0);
  assert(
    buffer.length >= 4 + length,
    `native host wrote an incomplete response frame: ${buffer.length}/${4 + length}`
  );
  return JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
}

function runLauncherHostInfo(launcherPath, env) {
  const command = process.platform === "win32" ? "cmd.exe" : launcherPath;
  const args =
    process.platform === "win32" ? ["/d", "/c", "call", launcherPath] : [];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    input: nativeMessageFrame({
      type: "HOST_INFO",
      requestId
    }),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.error) {
    fail(`launcher failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      [
        `launcher exited with ${result.status}`,
        result.stdout?.toString("utf8"),
        result.stderr?.toString("utf8")
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const response = parseNativeMessageFrame(result.stdout);
  assert(response.type === "HOST_INFO_RESULT", "launcher should return HOST_INFO_RESULT");
  assert(response.requestId === requestId, "launcher should preserve requestId");
  assert(response.ok === true, "HOST_INFO should be ok");
  assert(response.hostVersion === packageJson.version, "HOST_INFO should report package host version");
  assert(response.protocolVersion === 1, "HOST_INFO should report protocol version 1");
}

function assertWindowsRegistry(manifestPath) {
  for (const view of ["/reg:32", "/reg:64"]) {
    const result = run("reg.exe", ["query", smokeRegistryKey, "/ve", view]);
    assert(
      result.stdout.includes(manifestPath),
      `registry ${view} should point at smoke manifest`
    );
  }
}

function assertWindowsRegistryRemoved() {
  for (const view of ["/reg:32", "/reg:64"]) {
    const result = runOptional("reg.exe", ["query", smokeRegistryKey, "/ve", view]);
    assert(result.status !== 0, `registry ${view} should be removed after uninstall`);
  }
}

function removeWindowsSmokeRegistry() {
  for (const view of ["/reg:32", "/reg:64"]) {
    runOptional("reg.exe", ["delete", smokeRegistryKey, "/f", view]);
  }
}

function cleanupInstall(command, env) {
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS === "true") {
    run(command, uninstallArgs(), { env });
    return;
  }

  removeWindowsSmokeRegistry();
  rmSync(localAppData, { recursive: true, force: true });
}

function runSmoke() {
  const helper = helperPath();
  assert(existsSync(helper), `release helper was not built: ${helper}`);

  const command = installerCommand();
  const env = installerEnv();

  try {
    const installResult = parseJsonOutput(
      run(command, installArgs(helper), { env }),
      "installer"
    );
    assert(installResult.ok === true, "installer should report ok");
    assert(
      installResult.installedVersion === smokeVersion,
      "installer should report installed version"
    );
    assert(existsSync(installResult.helperPath), "installer should copy helper");
    assert(existsSync(installResult.updaterPath), "installer should persist updater");

    const launcherPath = launcherFromManifest(installResult);
    if (process.platform === "win32") {
      assertWindowsRegistry(installResult.manifests[0]);
    }

    const status = run(command, statusArgs(), { env });
    assert(
      status.stdout.includes(`installed native host ${smokeVersion}`),
      "status should report installed host"
    );

    runLauncherHostInfo(launcherPath, env);

    cleanupInstall(command, env);
    const afterUninstall = run(command, statusArgs(), { env });
    assert(
      afterUninstall.stdout.includes("not installed"),
      "status should report not installed after uninstall"
    );

    if (process.platform === "win32") {
      assertWindowsRegistryRemoved();
    }

    console.log(`native-host-installer-smoke: ${process.platform} installer smoke passed.`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

runSmoke();
