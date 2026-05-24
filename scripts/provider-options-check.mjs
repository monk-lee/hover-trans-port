import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`provider-options-check: ${message}`);
  process.exit(1);
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    fail(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(content, unexpected, label) {
  if (content.includes(unexpected)) {
    fail(`${label}: still contains ${JSON.stringify(unexpected)}`);
  }
}

const optionsHtml = readFileSync("src/options.html", "utf8");
const providersTs = readFileSync("src/shared/providers.ts", "utf8");
const optionsMainTs = readFileSync("src/options/main.ts", "utf8");
const nativeClientTs = readFileSync("src/background/nativeClient.ts", "utf8");

assertIncludes(
  optionsHtml,
  '<option value="claude">Claude CLI</option>',
  "Claude provider option is enabled"
);
assertIncludes(
  optionsHtml,
  '<option value="gemini">Gemini CLI</option>',
  "Gemini provider option is enabled"
);
assertIncludes(
  optionsHtml,
  '<option value="antigravity">Antigravity CLI</option>',
  "Antigravity provider option is enabled"
);
assertNotIncludes(
  optionsHtml,
  '<option value="claude" disabled>',
  "Claude provider option is not disabled"
);
assertNotIncludes(
  optionsHtml,
  '<option value="gemini" disabled>',
  "Gemini provider option is not disabled"
);

assertIncludes(providersTs, 'claude: "Claude CLI"', "Claude provider label");
assertIncludes(providersTs, 'gemini: "Gemini CLI"', "Gemini provider label");
assertIncludes(providersTs, 'antigravity: "Antigravity CLI"', "Antigravity provider label");
assertIncludes(providersTs, 'claude: "haiku"', "Claude provider default model");
assertIncludes(providersTs, 'gemini: ""', "Gemini provider default model");
assertIncludes(providersTs, 'antigravity: ""', "Antigravity provider default model");

assertIncludes(
  optionsMainTs,
  "function setProviderModelInput(",
  "provider model helper"
);
assertIncludes(
  optionsMainTs,
  "persistProviderModel = true",
  "saveOptions persist flag default"
);
assertIncludes(
  optionsMainTs,
  "persistProviderModel: false",
  "provider change preserves provider model"
);
assertIncludes(
  optionsMainTs,
  "getDefaultModelForProvider(modelProvider)",
  "provider model reset uses provider default"
);
assertIncludes(
  optionsMainTs,
  "Claude authentication is verified when translating.",
  "Claude status authentication copy"
);
assertNotIncludes(
  optionsMainTs,
  "getDefaultModelForProvider(modelProvider) || DEFAULT_CODEX_MODEL",
  "Claude model reset avoids Codex fallback"
);

assertIncludes(
  nativeClientTs,
  "function appendProviderDetail(",
  "provider detail helper"
);
assertIncludes(
  nativeClientTs,
  'case "PROVIDER_EXIT_NONZERO":\n      return appendProviderDetail(',
  "provider exit nonzero appends native detail"
);

console.log("provider-options-check: ok");
