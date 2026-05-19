import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NATIVE_HOST_NAME = "com.monklabs.hover_trans_port";
export const NATIVE_HOST_VERSION = "0.2.8";
export const APP_SUPPORT_DIR_NAME = "Hover Trans Port";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptsDir, "..");

export function getRepoNativeHostScriptPath() {
  return resolve(repoRoot, "native-host/host.mjs");
}

export function getCompiledNativeHostPath() {
  return resolve(repoRoot, "native-helper/target/release/hover-trans-port-helper");
}

// Compatibility alias for the Node native-host fallback.
export function getNativeHostScriptPath() {
  return getRepoNativeHostScriptPath();
}

export function getNativeHostInstallRoot(
  platform = process.platform,
  env = process.env
) {
  if (env.HOVER_TRANS_PORT_INSTALL_ROOT) {
    return resolve(env.HOVER_TRANS_PORT_INSTALL_ROOT);
  }

  if (platform === "darwin") {
    return resolve(
      homedir(),
      "Library/Application Support",
      APP_SUPPORT_DIR_NAME
    );
  }

  if (platform === "linux") {
    return resolve(homedir(), ".hover-trans-port/native-host");
  }

  throw new Error(`Unsupported native host install platform: ${platform}`);
}

export function getInstalledNativeHostVersionDir(
  version = NATIVE_HOST_VERSION,
  platform = process.platform,
  env = process.env
) {
  return resolve(getNativeHostInstallRoot(platform, env), "native-hosts", version);
}

export function getActiveNativeHostLinkPath(
  platform = process.platform,
  env = process.env
) {
  return resolve(getNativeHostInstallRoot(platform, env), "current");
}

export function getActiveNativeHostScriptPath(
  platform = process.platform,
  env = process.env
) {
  return resolve(getActiveNativeHostLinkPath(platform, env), "host.mjs");
}

export function getChromeNativeHostsDir(platform = process.platform) {
  if (platform === "darwin") {
    return resolve(
      homedir(),
      "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    );
  }

  if (platform === "linux") {
    return resolve(homedir(), ".config/google-chrome/NativeMessagingHosts");
  }

  throw new Error(`Unsupported native host install platform: ${platform}`);
}

export function getBrowserNativeHostsDirs(platform = process.platform) {
  if (platform === "darwin") {
    return [
      getChromeNativeHostsDir(platform),
      resolve(
        homedir(),
        "Library/Application Support/Naver/Whale/NativeMessagingHosts"
      ),
      resolve(
        homedir(),
        "Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts"
      )
    ];
  }

  return [getChromeNativeHostsDir(platform)];
}

export function getBrowserNativeHostManifestPaths(platform = process.platform) {
  return getBrowserNativeHostsDirs(platform).map((dir) =>
    resolve(dir, `${NATIVE_HOST_NAME}.json`)
  );
}

export function getNativeHostManifestPath(platform = process.platform) {
  return resolve(getChromeNativeHostsDir(platform), `${NATIVE_HOST_NAME}.json`);
}

export function getNativeHostLauncherPath(
  platform = process.platform,
  env = process.env
) {
  return resolve(getNativeHostInstallRoot(platform, env), "launcher");
}

export function getLegacyNativeHostLauncherPath(platform = process.platform) {
  return resolve(getChromeNativeHostsDir(platform), `${NATIVE_HOST_NAME}.sh`);
}

export function getExtensionIdFromManifestKey(manifestKey) {
  const keyBytes = Buffer.from(manifestKey, "base64");
  const hash = createHash("sha256").update(keyBytes).digest();

  return Array.from(hash.subarray(0, 16), (byte) => {
    const high = String.fromCharCode("a".charCodeAt(0) + (byte >> 4));
    const low = String.fromCharCode("a".charCodeAt(0) + (byte & 15));
    return `${high}${low}`;
  }).join("");
}

export function renderNativeHostManifest({ extensionId, hostPath }) {
  return {
    name: NATIVE_HOST_NAME,
    description: "Hover Trans Port Native Host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}
