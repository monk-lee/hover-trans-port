import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
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

function run(args, env) {
  return execFileSync("bash", [installer, ...args], {
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

function runJson(args, env) {
  return JSON.parse(run(args.concat("--json"), env));
}

function makeFixtureHelper(root, label = "fixture") {
  const helper = join(root, `hover-trans-port-helper-${label}`);
  writeFileSync(helper, "#!/bin/sh\nprintf 'fixture helper\\n'\n");
  chmodSync(helper, 0o755);
  return helper;
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
  assert(output.includes("installed native host 0.2.4"), "install output should name host version");

  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  const versionDir = join(installRoot, "native-hosts/0.2.4");
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
  const metadata = readMetadata(installRoot, "0.2.4");
  assert(metadata.hostVersion === "0.2.4", "metadata should name host version");
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

  const update = runJson(["update", "--host-version", "0.2.4", "--helper-source", helperV2], env);
  assert(update.ok === true, "json update should report ok");
  assert(update.command === "update", "json update should name command");
  assert(update.previousVersion === "0.1.0", "json update should name previous version");
  assert(update.installedVersion === "0.2.4", "json update should name installed version");
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
  run(["install", "--host-version", "0.2.4", "--helper-source", helperV2], env);

  const installRoot = env.HOVER_TRANS_PORT_INSTALL_ROOT;
  assert(existsSync(join(installRoot, "native-hosts/0.1.0/hover-trans-port-helper")), "old version should remain");
  assert(existsSync(join(installRoot, "native-hosts/0.2.4/hover-trans-port-helper")), "new version should exist");
  assert(
    readlinkSync(join(installRoot, "current")) === join(installRoot, "native-hosts/0.2.4"),
    "current should point at updated version"
  );
});

withTempRoot("status-uninstall", (root) => {
  const env = makeEnv(root);
  const helper = makeFixtureHelper(root);

  const before = run(["status"], env);
  assert(before.includes("not installed"), "status before install should report not installed");

  run(["install", "--helper-source", helper], env);
  const status = run(["status"], env);
  assert(status.includes("installed native host 0.2.4"), "status should report installed version");

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
