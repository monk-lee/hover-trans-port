import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, expected, path) {
  if (!content.includes(expected)) {
    throw new Error(`${path} is missing expected content: ${expected}`);
  }
}

function assertNotIncludes(content, unexpected, path) {
  if (content.includes(unexpected)) {
    throw new Error(`${path} still includes unexpected content: ${unexpected}`);
  }
}

const optionsHtml = read("src/options.html");
const providers = read("src/shared/providers.ts");
const nativeProtocol = read("src/shared/nativeProtocol.ts");
const messages = read("src/shared/messages.ts");
const optionsMain = read("src/options/main.ts");
const localBridge = read("native-host/src/localBridge.mjs");
const codexProvider = read("native-host/src/providers/CodexProvider.mjs");
const providerRegistry = read("native-host/src/providers/providerRegistry.mjs");

assertIncludes(optionsHtml, '<option value="claude">Claude CLI</option>', "src/options.html");
assertIncludes(optionsHtml, '<option value="gemini">Gemini CLI</option>', "src/options.html");
assertIncludes(optionsHtml, '<option value="opencode">OpenCode CLI</option>', "src/options.html");
assertIncludes(optionsHtml, '<option value="antigravity">Antigravity CLI</option>', "src/options.html");
assertIncludes(optionsHtml, '<select id="provider-model">', "src/options.html");
assertNotIncludes(optionsHtml, '<input id="provider-model"', "src/options.html");

assertIncludes(providers, "ProviderModelCatalog", "src/shared/providers.ts");
assertIncludes(
  providers,
  "PROVIDER_FALLBACK_MODEL_CATALOGS",
  "src/shared/providers.ts"
);
assertIncludes(providers, 'codex: "gpt-5.4-mini"', "src/shared/providers.ts");
assertIncludes(providers, 'claude: "haiku"', "src/shared/providers.ts");
assertIncludes(providers, 'opencode: ""', "src/shared/providers.ts");
assertIncludes(providers, 'antigravity: "Antigravity CLI"', "src/shared/providers.ts");
assertIncludes(providers, 'provider: "antigravity"', "src/shared/providers.ts");
assertIncludes(providers, 'label: "Default (Antigravity CLI)"', "src/shared/providers.ts");
assertIncludes(providers, "supportsCustomModel: false", "src/shared/providers.ts");
assertIncludes(providers, 'value: "gpt-5.5"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gpt-5.4-mini"', "src/shared/providers.ts");
assertNotIncludes(providers, 'value: "gpt-5.4-nano"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "haiku"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "sonnet"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "opus"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "default"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gemini-2.5-flash"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gemini-2.5-pro"', "src/shared/providers.ts");
assertIncludes(providers, 'label: "Default (OpenCode CLI)"', "src/shared/providers.ts");
assertIncludes(nativeProtocol, '"PROVIDER_MODELS"', "src/shared/nativeProtocol.ts");
assertIncludes(
  nativeProtocol,
  '"PROVIDER_MODELS_RESULT"',
  "src/shared/nativeProtocol.ts"
);
assertIncludes(messages, '"GET_PROVIDER_MODELS"', "src/shared/messages.ts");
assertIncludes(messages, '"PROVIDER_MODELS_RESULT"', "src/shared/messages.ts");
assertIncludes(localBridge, '"PROVIDER_MODELS"', "native-host/src/localBridge.mjs");
assertIncludes(
  codexProvider,
  '"debug", "models"',
  "native-host/src/providers/CodexProvider.mjs"
);
assertIncludes(
  providerRegistry,
  "modelCatalog",
  "native-host/src/providers/providerRegistry.mjs"
);

assertIncludes(
  optionsMain,
  'document.querySelector<HTMLSelectElement>("#provider-model")',
  "src/options/main.ts"
);
assertIncludes(
  optionsMain,
  "populateProviderModelOptions",
  "src/options/main.ts"
);
assertIncludes(
  optionsMain,
  "setProviderModelInputForProvider",
  "src/options/main.ts"
);
assertIncludes(
  optionsMain,
  "providerStatusCheckSequence",
  "src/options/main.ts"
);
assertIncludes(
  optionsMain,
  "isCurrentProviderStatusCheck",
  "src/options/main.ts"
);
