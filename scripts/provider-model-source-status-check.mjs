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
  console.error(`provider-model-source-status-check: ${message}`);
  process.exit(1);
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    fail(`${label}: expected ${JSON.stringify(actual)} to include ${expected}`);
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
  children = [];
  dataset = {};
  hidden = false;
  listeners = new Map();
  options = this.children;
  placeholder = "";
  textContent = "";
  value = "";

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  append(child) {
    this.children.push(child);
    this.options = this.children;
  }

  focus() {}

  replaceChildren(...children) {
    this.children = children;
    this.options = this.children;
  }

  setAttribute() {}
}

async function settlePromises() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createOptionsElements() {
  return new Map(
    [
      "#enabled",
      "#target-language",
      "#target-language-custom-row",
      "#target-language-custom",
      "#trigger-hotkey-display",
      "#trigger-hotkey-record",
      "#trigger-hotkey-reset",
      "#trigger-hotkey-status",
      "#save-state",
      "#native-host-ping",
      "#native-host-status",
      "#provider",
      "#provider-status-check",
      "#provider-model-reset",
      "#provider-model",
      "#provider-status",
      "#timeout-ms",
      "#cache-enabled",
      "#debug-logging",
      "#debug-log-path",
      "#debug-log-status",
      "#debug-log-view",
      "#debug-log-content",
      "#debug-log-refresh",
      "#debug-log-clear",
      "#cache-clear",
      "#cache-status"
    ].map((selector) => [selector, new FakeElement()])
  );
}

async function runOptionsWithCatalogSource(source) {
  const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-options-"));
  const tempSharedDir = join(tempDir, "src/shared");
  const tempOptionsDir = join(tempDir, "src/options");
  const elements = createOptionsElements();
  const unhandledRejections = [];

  mkdirSync(tempSharedDir, { recursive: true });
  mkdirSync(tempOptionsDir, { recursive: true });
  writeFileSync(
    join(tempSharedDir, "providers.js"),
    transpile("src/shared/providers.ts")
  );
  writeFileSync(
    join(tempSharedDir, "hotkeys.js"),
    transpile("src/shared/hotkeys.ts")
  );
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
    join(tempOptionsDir, "main.js"),
    transpile("src/options/main.ts")
      .replace("../shared/nativeHostUpdate", "../shared/nativeHostUpdate.js")
      .replace("../shared/providers", "../shared/providers.js")
      .replace("../shared/options", "../shared/options.js")
      .replace("../shared/hotkeys", "../shared/hotkeys.js")
      .replace('import "./options.css";', "")
  );

  global.document = {
    createElement() {
      return new FakeElement();
    },
    querySelector(selector) {
      return elements.get(selector) ?? null;
    }
  };
  global.window = {
    addEventListener() {},
    removeEventListener() {}
  };
  global.chrome = {
    i18n: {
      getUILanguage() {
        return "en-US";
      }
    },
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
      async sendMessage(message) {
        if (message.type === "CHECK_PROVIDER_STATUS") {
          return {
            type: "PROVIDER_STATUS",
            requestId: message.requestId,
            ok: true,
            providers: [
              {
                id: "codex",
                available: true,
                version: "codex test",
                binaryPath: "/usr/local/bin/codex"
              }
            ]
          };
        }

        if (message.type === "GET_PROVIDER_MODELS") {
          return {
            type: "PROVIDER_MODELS_RESULT",
            requestId: message.requestId,
            ok: true,
            catalog: {
              provider: "codex",
              defaultModel: "gpt-5.4-mini",
              models: [
                {
                  value: "gpt-5.4-mini",
                  label: "GPT-5.4 Mini",
                  recommended: true
                }
              ],
              supportsCustomModel: true,
              source
            }
          };
        }

        if (message.type === "GET_DEBUG_LOG_INFO") {
          return {
            type: "DEBUG_LOG_INFO_RESULT",
            requestId: message.requestId,
            ok: true,
            logPath: "/tmp/hover-trans-port.log",
            exists: false,
            sizeBytes: 0
          };
        }

        throw new Error(`Unexpected message type: ${message.type}`);
      }
    }
  };

  function onUnhandledRejection(reason) {
    unhandledRejections.push(reason);
  }

  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await import(pathToFileURL(join(tempOptionsDir, "main.js")).href);
    await settlePromises();

    if (unhandledRejections.length > 0) {
      fail(`unexpected rejection: ${String(unhandledRejections[0])}`);
    }

    return elements.get("#provider-status").textContent;
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

assertIncludes(
  await runOptionsWithCatalogSource("cli"),
  "Models loaded from Codex CLI.",
  "cli catalog source status"
);
assertIncludes(
  await runOptionsWithCatalogSource("fallback"),
  "Models loaded from fallback aliases.",
  "fallback catalog source status"
);

console.log("provider-model-source-status-check: ok");
