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
const optionsMain = read("src/options/main.ts");

assertIncludes(optionsHtml, '<option value="claude">Claude CLI</option>', "src/options.html");
assertIncludes(optionsHtml, '<select id="provider-model">', "src/options.html");
assertNotIncludes(optionsHtml, '<input id="provider-model"', "src/options.html");

assertIncludes(providers, "PROVIDER_MODEL_OPTIONS", "src/shared/providers.ts");
assertIncludes(providers, 'codex: "gpt-5.4-mini"', "src/shared/providers.ts");
assertIncludes(providers, 'claude: "haiku"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gpt-5.5"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gpt-5.4-mini"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "gpt-5.4-nano"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "haiku"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "sonnet"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "opus"', "src/shared/providers.ts");
assertIncludes(providers, 'value: "default"', "src/shared/providers.ts");

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
