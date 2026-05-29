import { resolve, win32 } from "node:path";

export const NATIVE_HOST_NAME = "com.monklabs.hover_trans_port";

export const BROWSER_TARGET_IDS = [
  "chrome",
  "chromium",
  "edge",
  "brave",
  "whale",
  "atlas",
  "vivaldi"
];

const BROWSER_LABELS = {
  chrome: "Google Chrome",
  chromium: "Chromium",
  edge: "Microsoft Edge",
  brave: "Brave",
  whale: "Naver Whale",
  atlas: "ChatGPT Atlas",
  vivaldi: "Vivaldi"
};

const SUPPORT = {
  chrome: "official-doc-backed",
  chromium: "official-doc-backed",
  edge: "official-doc-backed",
  brave: "repo-reference-backed",
  whale: "declared-only",
  atlas: "declared-only",
  vivaldi: "declared-only"
};

export function normalizeBrowserSelection(rawValue) {
  const normalizedValue = String(rawValue ?? "").trim().toLowerCase();
  if (!normalizedValue || normalizedValue === "all") {
    return [...BROWSER_TARGET_IDS];
  }

  const selected = normalizedValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (selected.length === 0) {
    throw new Error("No browser targets selected.");
  }

  const unsupported = selected.filter(
    (value) => !BROWSER_TARGET_IDS.includes(value)
  );

  if (unsupported.length > 0) {
    throw new Error(`Unsupported browser target(s): ${unsupported.join(", ")}`);
  }

  return [...new Set(selected)];
}

export function getWindowsRegistryViews() {
  return ["/reg:32", "/reg:64"];
}

export function getNativeHostBrowserTargets(
  platform,
  homeDir,
  browserSelection = "all"
) {
  const selected = normalizeBrowserSelection(browserSelection);
  return selected.map((id) => createTarget(platform, homeDir, id));
}

function createTarget(platform, homeDir, id) {
  if (platform === "darwin") {
    return {
      id,
      label: BROWSER_LABELS[id],
      kind: "manifest",
      support: SUPPORT[id],
      manifestDir: macManifestDir(homeDir, id)
    };
  }

  if (platform === "linux") {
    return {
      id,
      label: BROWSER_LABELS[id],
      kind: "manifest",
      support: SUPPORT[id],
      manifestDir: linuxManifestDir(homeDir, id)
    };
  }

  if (platform === "win32") {
    return {
      id,
      label: BROWSER_LABELS[id],
      kind: "windows-registry",
      support: SUPPORT[id],
      manifestDir: windowsManifestDir(homeDir, id),
      registryKey: windowsRegistryKey(id)
    };
  }

  throw new Error(`Unsupported native host install platform: ${platform}`);
}

function macManifestDir(homeDir, id) {
  const roots = {
    chrome: [
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts"
    ],
    chromium: [
      "Library",
      "Application Support",
      "Chromium",
      "NativeMessagingHosts"
    ],
    edge: [
      "Library",
      "Application Support",
      "Microsoft Edge",
      "NativeMessagingHosts"
    ],
    brave: [
      "Library",
      "Application Support",
      "BraveSoftware",
      "Brave-Browser",
      "NativeMessagingHosts"
    ],
    whale: [
      "Library",
      "Application Support",
      "Naver",
      "Whale",
      "NativeMessagingHosts"
    ],
    atlas: [
      "Library",
      "Application Support",
      "OpenAI",
      "ChatGPT Atlas",
      "NativeMessagingHosts"
    ],
    vivaldi: [
      "Library",
      "Application Support",
      "Vivaldi",
      "NativeMessagingHosts"
    ]
  };
  return resolve(homeDir, ...roots[id]);
}

function linuxManifestDir(homeDir, id) {
  const roots = {
    chrome: [".config", "google-chrome", "NativeMessagingHosts"],
    chromium: [".config", "chromium", "NativeMessagingHosts"],
    edge: [".config", "microsoft-edge", "NativeMessagingHosts"],
    brave: [
      ".config",
      "BraveSoftware",
      "Brave-Browser",
      "NativeMessagingHosts"
    ],
    whale: [".config", "naver-whale", "NativeMessagingHosts"],
    atlas: [".config", "chatgpt-atlas", "NativeMessagingHosts"],
    vivaldi: [".config", "vivaldi", "NativeMessagingHosts"]
  };
  return resolve(homeDir, ...roots[id]);
}

function windowsManifestDir(homeDir, id) {
  return win32.resolve(
    homeDir,
    "AppData",
    "Local",
    "Hover Trans Port",
    "NativeMessagingHosts",
    id
  );
}

function windowsRegistryKey(id) {
  const roots = {
    chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
    chromium: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
    edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
    brave: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
    whale: "HKCU\\Software\\Naver\\Whale\\NativeMessagingHosts",
    atlas: "HKCU\\Software\\OpenAI\\ChatGPT Atlas\\NativeMessagingHosts",
    vivaldi: "HKCU\\Software\\Vivaldi\\NativeMessagingHosts"
  };
  return `${roots[id]}\\${NATIVE_HOST_NAME}`;
}
