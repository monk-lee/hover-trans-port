import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_HOST_NAME,
  getNativeHostBrowserTargets
} from "./native-host-browser-targets.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(repoRoot, "scripts/install.sh");
const macosCompatibilityInstaller = join(
  repoRoot,
  "scripts/install-macos-native-host.sh"
);
const windowsInstaller = join(repoRoot, "scripts/install-windows-native-host.ps1");
const extensionId = "mmbmjpmhmlkjknhcigafgplahdbicabe";
const embeddedPayloadMarker = "HOVER_TRANS_PORT_INSTALL_SH_PAYLOAD";
const powershellInstaller = readFileSync(windowsInstaller, "utf8");

function extractEmbeddedInstallPayload() {
  const wrapper = readFileSync(macosCompatibilityInstaller, "utf8");
  const startMarker = `cat > "$fallback" <<'${embeddedPayloadMarker}'\n`;
  const endMarker = `\n${embeddedPayloadMarker}\n`;
  const start = wrapper.indexOf(startMarker);
  const end = wrapper.indexOf(endMarker, start + startMarker.length);

  assert(start !== -1, "legacy macOS wrapper should contain embedded payload start marker");
  assert(end !== -1, "legacy macOS wrapper should contain embedded payload end marker");

  return `${wrapper.slice(start + startMarker.length, end)}\n`;
}

function runWithInstaller(installerPath, args, env) {
  return execFileSync("bash", [installerPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      HOVER_TRANS_PORT_EXTENSION_ID: extensionId
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function run(args, env) {
  return runWithInstaller(installer, args, env);
}

function runJson(args, env) {
  return JSON.parse(run(args.concat("--json"), env));
}

function runFailure(args, env) {
  try {
    run(args, env);
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }

  throw new Error(`expected installer to fail for args: ${args.join(" ")}`);
}

function runInstallerJson(installerPath, args, env) {
  return JSON.parse(runWithInstaller(installerPath, args.concat("--json"), env));
}

function runInstallerViaStdinJson(installerPath, args, env) {
  return JSON.parse(execFileSync("bash", ["-s", ...args.concat("--json")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      HOVER_TRANS_PORT_EXTENSION_ID: extensionId
    },
    input: readFileSync(installerPath, "utf8"),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  }));
}

function makeFixtureHelper(root, label = "fixture") {
  const helper = join(root, `hover-trans-port-helper-${label}`);
  writeFileSync(helper, "#!/bin/sh\nprintf 'fixture helper\\n'\n");
  chmodSync(helper, 0o755);
  return helper;
}

function currentMacosAssetName() {
  const machine = execFileSync("uname", ["-m"], { encoding: "utf8" }).trim();

  if (machine === "arm64") {
    return "hover-trans-port-helper-macos-arm64";
  }

  if (machine === "x86_64") {
    return "hover-trans-port-helper-macos-x64";
  }

  throw new Error(`unsupported test architecture: ${machine}`);
}

function writeReleaseFixture(root, tag, assetName, helperBody) {
  const releaseDir = join(root, "releases", "download", tag);
  const helperPath = join(releaseDir, assetName);

  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(helperPath, helperBody, { mode: 0o755, flush: true });
  chmodSync(helperPath, 0o755);

  const checksum = execFileSync("shasum", ["-a", "256", helperPath], {
    encoding: "utf8"
  }).split(" ")[0];

  writeFileSync(join(releaseDir, "checksums.txt"), `${checksum}  ${assetName}\n`);

  return `file://${join(root, "releases")}`;
}

function makeEnv(root) {
  const home = join(root, "home");
  return {
    HOME: home,
    HOVER_TRANS_PORT_TEST_OS: "macos",
    HOVER_TRANS_PORT_INSTALL_ROOT: join(
      home,
      "Library/Application Support/Hover Trans Port"
    ),
    HOVER_TRANS_PORT_CHROME_NATIVE_HOSTS_DIR: join(
      home,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ),
    HOVER_TRANS_PORT_WHALE_NATIVE_HOSTS_DIR: join(
      home,
      "Library/Application Support/Naver/Whale/NativeMessagingHosts"
    ),
    HOVER_TRANS_PORT_ATLAS_NATIVE_HOSTS_DIR: join(
      home,
      "Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts"
    )
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readMetadata(installRoot, version) {
  return readJson(join(installRoot, "native-hosts", version, "metadata.json"));
}

function expectedManifestPaths(platform, home) {
  return getNativeHostBrowserTargets(platform, home).map((target) =>
    join(target.manifestDir, `${NATIVE_HOST_NAME}.json`)
  );
}

function withTempRoot(name, fn) {
  const root = mkdtempSync(join(tmpdir(), `hover-trans-port-${name}-`));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeInstallerTempDir(root) {
  const installerTmp = join(root, "tmp");
  mkdirSync(installerTmp, { recursive: true });
  return installerTmp;
}

function installerTempEntries(installerTmp) {
  if (!existsSync(installerTmp)) {
    return [];
  }

  return readdirSync(installerTmp).filter((entry) =>
    entry.startsWith("hover-trans-port-installer.")
  );
}

assert(
  extractEmbeddedInstallPayload() === readFileSync(installer, "utf8"),
  "legacy macOS wrapper embedded payload should match install.sh"
);
assert(
  powershellInstaller.includes('[ValidateSet("install", "update", "status", "uninstall")]'),
  "PowerShell installer should validate command values"
);
assert(
  powershellInstaller.includes('$Command = "install"'),
  "PowerShell installer should default to install"
);
assert(
  powershellInstaller.includes("$PSCommandPath"),
  "PowerShell installer should handle file-backed invocation"
);
assert(
  powershellInstaller.includes("Invoke-WebRequest"),
  "PowerShell installer should download release assets"
);
assert(
  powershellInstaller.includes("update-native-host.cmd"),
  "PowerShell installer should persist updater cmd shim"
);
assert(
  powershellInstaller.includes("/reg:32"),
  "PowerShell installer should register 32-bit registry view"
);
assert(
  powershellInstaller.includes("/reg:64"),
  "PowerShell installer should register 64-bit registry view"
);

withTempRoot("linux-install", (root) => {
  const home = join(root, "home");
  const env = {
    HOME: home,
    HOVER_TRANS_PORT_TEST_OS: "linux",
    HOVER_TRANS_PORT_INSTALL_ROOT: join(home, ".local/share/hover-trans-port")
  };
  const helper = makeFixtureHelper(root);

  const result = runJson(["install", "--helper-source", helper], env);

  assert(result.ok === true, "linux json install should report ok");
  assert(result.installedVersion === "0.2.14", "linux install should name host version");
  assert(result.installRoot === env.HOVER_TRANS_PORT_INSTALL_ROOT, "linux install root should be XDG-style");
  assert(
    JSON.stringify(result.manifests) === JSON.stringify(expectedManifestPaths("linux", home)),
    "linux install manifests should match native browser target contract"
  );
  assert(
    result.manifests.some((path) => path.endsWith(".config/google-chrome/NativeMessagingHosts/com.monklabs.hover_trans_port.json")),
    "linux install should include Chrome manifest"
  );
  assert(
    result.manifests.some((path) => path.endsWith(".config/chromium/NativeMessagingHosts/com.monklabs.hover_trans_port.json")),
    "linux install should include Chromium manifest"
  );
});

withTempRoot("linux-release-download", (root) => {
  const home = join(root, "home");
  const installerTmp = makeInstallerTempDir(root);
  const helperBody = "#!/bin/sh\nprintf 'downloaded linux helper\\n'\n";
  const releaseBaseUrl = writeReleaseFixture(
    root,
    "v0.2.14",
    "hover-trans-port-helper-linux-x64",
    helperBody
  );
  const env = {
    HOME: home,
    HOVER_TRANS_PORT_TEST_OS: "linux",
    HOVER_TRANS_PORT_TEST_ARCH: "x86_64",
    HOVER_TRANS_PORT_INSTALL_ROOT: join(home, ".local/share/hover-trans-port"),
    HOVER_TRANS_PORT_RELEASE_BASE_URL: releaseBaseUrl,
    TMPDIR: installerTmp
  };

  const result = runJson(["install", "--release-tag", "v0.2.14"], env);

  assert(result.ok === true, "linux release install should report ok");
  assert(result.installedVersion === "0.2.14", "linux release install should name host version");
  assert(
    readFileSync(result.helperPath, "utf8") === helperBody,
    "linux release install should download the linux helper asset"
  );
  assert(
    installerTempEntries(installerTmp).length === 0,
    "linux release install should clean installer download temp dirs"
  );
});

withTempRoot("linux-unsupported-arch", (root) => {
  const home = join(root, "home");
  const env = {
    HOME: home,
    HOVER_TRANS_PORT_TEST_OS: "linux",
    HOVER_TRANS_PORT_TEST_ARCH: "s390x",
    HOVER_TRANS_PORT_INSTALL_ROOT: join(home, ".local/share/hover-trans-port")
  };

  const result = runFailure(["install"], env);

  assert(result.status !== 0, "unsupported linux architecture should fail");
  assert(
    result.stderr.includes("install.sh: unsupported architecture: linux/s390x"),
    "unsupported linux architecture should report installer error"
  );
  assert(
    !result.stderr.includes("cp:"),
    "unsupported linux architecture should not continue into copy helper"
  );
});

withTempRoot("install", (root) => {
  const home = join(root, "home");
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const result = runJson(["install", "--helper-source", helper], env);
  assert(result.ok === true, "macOS json install should report ok");
  assert(result.installedVersion === "0.2.14", "macOS install should name host version");
  assert(
    JSON.stringify(result.manifests) === JSON.stringify(expectedManifestPaths("darwin", home)),
    "macOS install manifests should match native browser target contract"
  );

  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  const versionDir = join(installRoot, "native-hosts/0.2.14");
  const installedHelper = join(versionDir, "hover-trans-port-helper");
  const launcher = join(installRoot, "launcher");
  const current = join(installRoot, "current");
  const manifestPath = join(
    env.HOVER_TRANS_PORT_CHROME_NATIVE_HOSTS_DIR,
    "com.monklabs.hover_trans_port.json"
  );
  const whaleManifestPath = join(
    env.HOVER_TRANS_PORT_WHALE_NATIVE_HOSTS_DIR,
    "com.monklabs.hover_trans_port.json"
  );
  const atlasManifestPath = join(
    env.HOVER_TRANS_PORT_ATLAS_NATIVE_HOSTS_DIR,
    "com.monklabs.hover_trans_port.json"
  );

  assert(existsSync(installedHelper), "helper should be copied into version directory");
  assert((lstatSync(installedHelper).mode & 0o111) !== 0, "installed helper should be executable");
  const metadata = readMetadata(installRoot, "0.2.14");
  assert(metadata.hostVersion === "0.2.14", "metadata should name host version");
  assert(metadata.protocolVersion === 1, "metadata should name protocol version");
  assert(metadata.source === "unix-script-installer", "metadata should name installer source");
  assert(metadata.updaterPath === join(versionDir, "install.sh"), "metadata should name updater path");
  assert(existsSync(metadata.updaterPath), "version directory should contain updater script");
  assert((lstatSync(metadata.updaterPath).mode & 0o111) !== 0, "updater script should be executable");
  assert(
    expectedManifestPaths("darwin", home).every(existsSync),
    "macOS install should write full native browser target manifest matrix"
  );
  assert(existsSync(launcher), "launcher should be written");
  assert((lstatSync(launcher).mode & 0o111) !== 0, "launcher should be executable");
  assert(lstatSync(current).isSymbolicLink(), "current should be a symlink");
  assert(readlinkSync(current) === versionDir, "current should point at version directory");

  const manifest = readJson(manifestPath);
  assert(manifest.name === "com.monklabs.hover_trans_port", "manifest name should match native host");
  assert(manifest.path === launcher, "manifest should point at stable launcher");
  assert(manifest.type === "stdio", "manifest type should be stdio");
  assert(
    manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`),
    "manifest should allow the extension origin"
  );
  assert(
    readJson(whaleManifestPath).path === launcher,
    "Whale manifest should point at stable launcher"
  );
  assert(
    readJson(atlasManifestPath).path === launcher,
    "Atlas manifest should point at stable launcher"
  );
});

withTempRoot("macos-wrapper", (root) => {
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const result = runInstallerJson(
    macosCompatibilityInstaller,
    ["install", "--helper-source", helper],
    env
  );

  assert(result.ok === true, "macOS compatibility wrapper should report ok");
  assert(
    result.updaterPath === join(env.HOVER_TRANS_PORT_INSTALL_ROOT, "native-hosts/0.2.14/install.sh"),
    "macOS compatibility wrapper should persist install.sh updater path"
  );
});

withTempRoot("macos-legacy-standalone-payload", (root) => {
  const env = makeEnv(root);
  const installerTmp = makeInstallerTempDir(root);
  const payloadDir = join(root, "payload");
  const legacyInstaller = join(payloadDir, "install-macos-native-host.sh");
  const helperBody = "#!/bin/sh\nprintf 'standalone legacy helper\\n'\n";
  const helperAsset = join(payloadDir, currentMacosAssetName());

  mkdirSync(payloadDir, { recursive: true });
  copyFileSync(macosCompatibilityInstaller, legacyInstaller);
  chmodSync(legacyInstaller, 0o755);
  writeFileSync(helperAsset, helperBody, { mode: 0o755, flush: true });
  chmodSync(helperAsset, 0o755);

  const result = runInstallerJson(legacyInstaller, ["install"], {
    ...env,
    TMPDIR: installerTmp
  });

  assert(result.ok === true, "standalone legacy macOS payload should report ok");
  assert(result.installedVersion === "0.2.14", "standalone legacy macOS payload should install host version");
  assert(
    readFileSync(result.helperPath, "utf8") === helperBody,
    "standalone legacy macOS payload should use bundled helper beside wrapper"
  );
  assert(
    installerTempEntries(installerTmp).length === 0,
    "standalone legacy macOS payload should clean embedded fallback temp dir"
  );
});

withTempRoot("macos-legacy-pipe", (root) => {
  const env = makeEnv(root);
  const installerTmp = makeInstallerTempDir(root);
  const helper = makeFixtureHelper(root, "legacy-pipe");

  const result = runInstallerViaStdinJson(
    macosCompatibilityInstaller,
    ["install", "--helper-source", helper],
    {
      ...env,
      TMPDIR: installerTmp
    }
  );

  assert(result.ok === true, "pipe-style legacy macOS installer should report ok");
  assert(result.installedVersion === "0.2.14", "pipe-style legacy macOS installer should install host version");
  assert(
    installerTempEntries(installerTmp).length === 0,
    "pipe-style legacy macOS installer should clean embedded fallback temp dir"
  );
});

withTempRoot("json-update", (root) => {
  const env = makeEnv(root);
  const helperV1 = makeFixtureHelper(root, "json-v1");
  const helperV2 = makeFixtureHelper(root, "json-v2");

  const install = runJson(["install", "--host-version", "0.1.0", "--helper-source", helperV1], env);
  assert(install.ok === true, "json install should report ok");
  assert(install.command === "install", "json install should name command");
  assert(install.previousVersion === "", "json install should report no previous version");
  assert(install.installedVersion === "0.1.0", "json install should name installed version");
  assert(
    install.currentLink === join(env.HOVER_TRANS_PORT_INSTALL_ROOT, "current"),
    "json install should name current link"
  );
  assert(Array.isArray(install.manifests), "json install should list manifests");

  const update = runJson(["update", "--host-version", "0.2.5", "--helper-source", helperV2], env);
  assert(update.ok === true, "json update should report ok");
  assert(update.command === "update", "json update should name command");
  assert(update.previousVersion === "0.1.0", "json update should name previous version");
  assert(update.installedVersion === "0.2.5", "json update should name installed version");
  assert(
    update.currentLink === join(env.HOVER_TRANS_PORT_INSTALL_ROOT, "current"),
    "json update should name current link"
  );
});

withTempRoot("update", (root) => {
  const env = makeEnv(root);
  const helperV1 = makeFixtureHelper(root, "v1");
  const helperV2 = makeFixtureHelper(root, "v2");

  run(["install", "--host-version", "0.1.0", "--helper-source", helperV1], env);
  run(["install", "--host-version", "0.2.5", "--helper-source", helperV2], env);

  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  assert(existsSync(join(installRoot, "native-hosts/0.1.0/hover-trans-port-helper")), "old version should remain");
  assert(existsSync(join(installRoot, "native-hosts/0.2.5/hover-trans-port-helper")), "new version should exist");
  assert(
    readlinkSync(join(installRoot, "current")) === join(installRoot, "native-hosts/0.2.5"),
    "current should point at updated version"
  );
});

withTempRoot("persisted-updater-download", (root) => {
  const env = makeEnv(root);
  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  const previousVersionDir = join(installRoot, "native-hosts/0.2.4");
  const staleHelperBody = "#!/bin/sh\nprintf 'stale bundled helper\\n'\n";
  const downloadedHelperBody = "#!/bin/sh\nprintf 'downloaded release helper\\n'\n";
  const assetName = currentMacosAssetName();
  const releaseBaseUrl = writeReleaseFixture(
    root,
    "v0.2.14",
    assetName,
    downloadedHelperBody
  );

  rmSync(previousVersionDir, { recursive: true, force: true });
  mkdirSync(previousVersionDir, { recursive: true });
  writeFileSync(join(previousVersionDir, "hover-trans-port-helper"), staleHelperBody, {
    mode: 0o755,
    flush: true
  });
  chmodSync(join(previousVersionDir, "hover-trans-port-helper"), 0o755);
  const persistedUpdater = join(previousVersionDir, "install.sh");
  copyFileSync(installer, persistedUpdater);
  chmodSync(persistedUpdater, 0o755);

  const result = runInstallerJson(
    persistedUpdater,
    [
      "update",
      "--host-version",
      "0.2.14",
      "--release-tag",
      "v0.2.14"
    ],
    {
      ...env,
      HOVER_TRANS_PORT_RELEASE_BASE_URL: releaseBaseUrl
    }
  );

  assert(result.ok === true, "persisted updater should report ok");
  assert(result.installedVersion === "0.2.14", "persisted updater should install target version");

  const installedHelper = readFileSync(
    join(installRoot, "native-hosts/0.2.14/hover-trans-port-helper"),
    "utf8"
  );
  assert(
    installedHelper === downloadedHelperBody,
    "persisted updater must download the release helper instead of copying the old generic helper"
  );
});

withTempRoot("status-uninstall", (root) => {
  const home = join(root, "home");
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const before = run(["status"], env);
  assert(before.includes("not installed"), "status before install should report not installed");

  run(["install", "--helper-source", helper], env);
  const status = run(["status"], env);
  assert(status.includes("installed native host 0.2.14"), "status should report installed version");

  run(["uninstall"], env);
  assert(!existsSync(env.HOVER_TRANS_PORT_INSTALL_ROOT), "uninstall should remove install root");
  assert(
    expectedManifestPaths("darwin", home).every((manifestPath) => !existsSync(manifestPath)),
    "uninstall should remove every macOS native browser target manifest"
  );
});

withTempRoot("status-current-version", (root) => {
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  run(["install", "--host-version", "0.1.0", "--helper-source", helper], env);
  const status = run(["status"], env);
  assert(
    status.includes("installed native host 0.1.0"),
    "status should report the current symlink version"
  );
});

console.log("native-host-installer-check: install, update, status, and uninstall are valid.");
