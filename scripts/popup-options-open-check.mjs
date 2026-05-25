import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function fail(message) {
  console.error(`popup-options-open-check: ${message}`);
  process.exit(1);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
        actual
      )}`
    );
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
        actual
      )}`
    );
  }
}

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

class FakeElement {
  checked = false;
  dataset = {};
  listeners = new Map();
  textContent = "";

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this });
    }
  }
}

async function settlePromises() {
  await Promise.resolve();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-popup-"));
const tempSharedDir = join(tempDir, "src/shared");
const tempPopupDir = join(tempDir, "src/popup");
const optionsMainTs = readFileSync("src/options/main.ts", "utf8");
const nativeClientTs = readFileSync("src/background/nativeClient.ts", "utf8");
const serviceWorkerTs = readFileSync("src/background/service-worker.ts", "utf8");
mkdirSync(tempSharedDir, { recursive: true });
mkdirSync(tempPopupDir, { recursive: true });

assertEqual(
  optionsMainTs.includes("loadProviderModelCatalog"),
  true,
  "options model catalog loader is present"
);
assertEqual(
  optionsMainTs.includes('"GET_PROVIDER_MODELS"'),
  true,
  "options requests provider model catalogs"
);
assertEqual(
  nativeClientTs.includes("getProviderModels"),
  true,
  "background native client exposes provider model catalog helper"
);
assertEqual(
  nativeClientTs.includes('"PROVIDER_MODELS"'),
  true,
  "background native client sends provider model catalog request"
);
assertEqual(
  serviceWorkerTs.includes('"GET_PROVIDER_MODELS"'),
  true,
  "service worker handles provider model catalog requests"
);

writeFileSync(
  join(tempSharedDir, "providers.js"),
  transpile("src/shared/providers.ts")
);
writeFileSync(join(tempSharedDir, "hotkeys.js"), transpile("src/shared/hotkeys.ts"));
writeFileSync(
  join(tempSharedDir, "options.js"),
  transpile("src/shared/options.ts")
    .replace("./providers", "./providers.js")
    .replace("./hotkeys", "./hotkeys.js")
);
writeFileSync(
  join(tempSharedDir, "nativeHostUpdate.js"),
  transpile("src/shared/nativeHostUpdate.ts")
);
writeFileSync(
  join(tempPopupDir, "main.js"),
  transpile("src/popup/main.ts")
    .replace("../shared/nativeHostUpdate", "../shared/nativeHostUpdate.js")
    .replace("../shared/providers", "../shared/providers.js")
    .replace("../shared/options", "../shared/options.js")
    .replace('import "./popup.css";', "")
);

function createElements() {
  return new Map([
    ["#status-title", new FakeElement()],
    ["#status-detail", new FakeElement()],
    ["#status-indicator", new FakeElement()],
    ["#enabled", new FakeElement()],
    ["#open-options", new FakeElement()]
  ]);
}

let currentElements = createElements();
let nativeHostUpdateStatus = {
  checkedAt: Date.now(),
  nextCheckAt: Date.now() + 60 * 60 * 1000,
  failureCount: 1,
  lastErrorCode: "NATIVE_HOST_UPDATE_REQUIRED",
  ok: false,
  error: "NATIVE_HOST_UPDATE_REQUIRED",
  message:
    "One manual native host update is required before in-app updates are available.",
  retryable: false,
  manualUpdateRequired: true
};

global.document = {
  querySelector(selector) {
    return currentElements.get(selector) ?? null;
  }
};

let openOptionsPageCalls = 0;
const createdTabs = [];
const unhandledRejections = [];
const sentMessageTypes = [];
const sentProviderStatusProviders = [];

global.chrome = {
  storage: {
    local: {
      async get() {
        return {
          hoverTransPort: {
            enabled: true,
            provider: "codex"
          }
        };
      },
      async set() {}
    }
  },
  runtime: {
    getURL(path) {
      return `chrome-extension://extension-id/${path}`;
    },
    async openOptionsPage() {
      openOptionsPageCalls += 1;
      throw new Error("Could not create an options page.");
    },
    async sendMessage(message) {
      sentMessageTypes.push(message.type);
      if (message.type === "CHECK_PROVIDER_STATUS") {
        sentProviderStatusProviders.push(message.provider);
      }
      if (message.type === "GET_STORED_NATIVE_HOST_UPDATE_STATUS") {
        return {
          type: "NATIVE_HOST_UPDATE_STATUS",
          requestId: message.requestId,
          status: nativeHostUpdateStatus
        };
      }

      return {
        type: "PROVIDER_STATUS",
        requestId: message.requestId,
        ok: true,
        providers: [{ id: "codex", available: true, version: "test" }]
      };
    }
  },
  tabs: {
    async create(createProperties) {
      createdTabs.push(createProperties.url);
      return {};
    }
  }
};

function onUnhandledRejection(reason) {
  unhandledRejections.push(reason);
}

process.on("unhandledRejection", onUnhandledRejection);

async function importPopupWithStatus(status, cacheKey) {
  nativeHostUpdateStatus = status;
  currentElements = createElements();
  sentMessageTypes.length = 0;
  sentProviderStatusProviders.length = 0;

  await import(`${pathToFileURL(join(tempPopupDir, "main.js")).href}?${cacheKey}`);
  await settlePromises();

  return currentElements;
}

try {
  const manualUpdateElements = await importPopupWithStatus(
    {
      checkedAt: Date.now(),
      nextCheckAt: Date.now() + 60 * 60 * 1000,
      failureCount: 1,
      lastErrorCode: "NATIVE_HOST_UPDATE_REQUIRED",
      ok: false,
      error: "NATIVE_HOST_UPDATE_REQUIRED",
      message:
        "One manual native host update is required before in-app updates are available.",
      retryable: false,
      manualUpdateRequired: true
    },
    "manual-update"
  );

  assertDeepEqual(
    sentMessageTypes,
    ["GET_STORED_NATIVE_HOST_UPDATE_STATUS"],
    "manual native host update guidance prevents provider status check"
  );
  assertEqual(
    manualUpdateElements.get("#status-title").textContent,
    "Native Host update required",
    "popup manual update title"
  );
  assertEqual(
    manualUpdateElements
      .get("#status-detail")
      .textContent.includes(
        "curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash"
      ),
    true,
    "popup shows manual update command"
  );

  manualUpdateElements.get("#open-options").dispatch("click");
  await settlePromises();

  assertEqual(openOptionsPageCalls, 1, "managed options API is tried first");
  assertDeepEqual(
    createdTabs,
    ["chrome-extension://extension-id/options.html"],
    "options URL is opened directly when managed options creation fails"
  );
  assertEqual(
    unhandledRejections.length,
    0,
    "options opening failures are handled"
  );

  const updateAvailableElements = await importPopupWithStatus(
    {
      checkedAt: Date.now(),
      nextCheckAt: Date.now() + 24 * 60 * 60 * 1000,
      failureCount: 0,
      ok: true,
      installedVersion: "0.2.5",
      latestVersion: "0.2.12",
      latestTag: "v0.2.12",
      updateAvailable: true,
      releaseUrl: "https://github.com/monk-lee/hover-trans-port/releases/tag/v0.2.12"
    },
    "update-available"
  );

  assertEqual(
    updateAvailableElements.get("#status-detail").textContent,
    "Native Host 0.2.5 -> 0.2.12. Open Options to update.",
    "popup update available detail is compact"
  );
  assertEqual(
    updateAvailableElements
      .get("#status-detail")
      .textContent.includes("Open Options for details."),
    false,
    "popup update available detail does not duplicate options guidance"
  );
} finally {
  process.off("unhandledRejection", onUnhandledRejection);
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("popup-options-open-check: ok");
