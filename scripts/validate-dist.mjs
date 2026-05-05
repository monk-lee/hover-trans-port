import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distRoot = new URL("../dist/", import.meta.url);
const manifestPath = new URL("manifest.json", distRoot);

function fail(message) {
  console.error(`validate-dist: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail("dist/manifest.json was not found. Run pnpm build first.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredFiles = [
  manifest.action?.default_popup,
  manifest.options_page,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? [])
].filter(Boolean);
const contentScriptFiles = (manifest.content_scripts ?? [])
  .flatMap((script) => script.js ?? [])
  .filter(Boolean);
const staticModuleSyntaxPattern = /^\s*(?:import(?:\s|[{"'*])|export(?:\s|[{\*]))/m;

for (const relativePath of requiredFiles) {
  const targetPath = join(distRoot.pathname, relativePath);

  if (!existsSync(targetPath)) {
    fail(`manifest references missing file: ${relativePath}`);
  }
}

for (const relativePath of contentScriptFiles) {
  const targetPath = join(distRoot.pathname, relativePath);
  const content = readFileSync(targetPath, "utf8");

  if (staticModuleSyntaxPattern.test(content)) {
    fail(`content script must not contain static module syntax: ${relativePath}`);
  }
}

console.log("validate-dist: manifest references are present.");
