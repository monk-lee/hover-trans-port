import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(repoRoot, "scripts/install-macos-native-host.sh");
const extensionId = "mmbmjpmhmlkjknhcigafgplahdbicabe";

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

function runInstallerJson(installerPath, args, env) {
  return JSON.parse(runWithInstaller(installerPath, args.concat("--json"), env));
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

function withTempRoot(name, fn) {
  const root = mkdtempSync(join(tmpdir(), `hover-trans-port-${name}-`));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

withTempRoot("install", (root) => {
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const output = run(["install", "--helper-source", helper], env);
  assert(output.includes("installed native host 0.2.6"), "install output should name host version");

  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  const versionDir = join(installRoot, "native-hosts/0.2.6");
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
  const metadata = readMetadata(installRoot, "0.2.6");
  assert(metadata.hostVersion === "0.2.6", "metadata should name host version");
  assert(metadata.protocolVersion === 1, "metadata should name protocol version");
  assert(metadata.source === "macos-script-installer", "metadata should name installer source");
  assert(metadata.updaterPath === join(versionDir, "install-macos-native-host.sh"), "metadata should name updater path");
  assert(existsSync(metadata.updaterPath), "version directory should contain updater script");
  assert((lstatSync(metadata.updaterPath).mode & 0o111) !== 0, "updater script should be executable");
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
    "v0.2.6",
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
  const persistedUpdater = join(previousVersionDir, "install-macos-native-host.sh");
  copyFileSync(installer, persistedUpdater);
  chmodSync(persistedUpdater, 0o755);

  const result = runInstallerJson(
    persistedUpdater,
    [
      "update",
      "--host-version",
      "0.2.6",
      "--release-tag",
      "v0.2.6"
    ],
    {
      ...env,
      HOVER_TRANS_PORT_RELEASE_BASE_URL: releaseBaseUrl
    }
  );

  assert(result.ok === true, "persisted updater should report ok");
  assert(result.installedVersion === "0.2.6", "persisted updater should install target version");

  const installedHelper = readFileSync(
    join(installRoot, "native-hosts/0.2.6/hover-trans-port-helper"),
    "utf8"
  );
  assert(
    installedHelper === downloadedHelperBody,
    "persisted updater must download the release helper instead of copying the old generic helper"
  );
});

withTempRoot("status-uninstall", (root) => {
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const before = run(["status"], env);
  assert(before.includes("not installed"), "status before install should report not installed");

  run(["install", "--helper-source", helper], env);
  const status = run(["status"], env);
  assert(status.includes("installed native host 0.2.6"), "status should report installed version");

  run(["uninstall"], env);
  assert(!existsSync(env.HOVER_TRANS_PORT_INSTALL_ROOT), "uninstall should remove install root");
  assert(
    !existsSync(join(env.HOVER_TRANS_PORT_CHROME_NATIVE_HOSTS_DIR, "com.monklabs.hover_trans_port.json")),
    "uninstall should remove Chrome manifest"
  );
  assert(
    !existsSync(join(env.HOVER_TRANS_PORT_WHALE_NATIVE_HOSTS_DIR, "com.monklabs.hover_trans_port.json")),
    "uninstall should remove Whale manifest"
  );
  assert(
    !existsSync(join(env.HOVER_TRANS_PORT_ATLAS_NATIVE_HOSTS_DIR, "com.monklabs.hover_trans_port.json")),
    "uninstall should remove Atlas manifest"
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

console.log("macos-script-installer-check: install, update, status, and uninstall are valid.");
