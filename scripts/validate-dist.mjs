import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distRoot = new URL("../dist/", import.meta.url);
const manifestPath = new URL("manifest.json", distRoot);
const packageJsonPath = new URL("../package.json", import.meta.url);

function fail(message) {
  console.error(`validate-dist: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail("dist/manifest.json was not found. Run pnpm build first.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const requiredIconSizes = ["16", "32", "48", "128"];

function collectIconFiles(iconMap, fieldName) {
  if (!iconMap || typeof iconMap !== "object") {
    fail(`manifest is missing ${fieldName}.`);
  }

  return requiredIconSizes.map((size) => {
    const relativePath = iconMap[size];

    if (typeof relativePath !== "string" || relativePath.length === 0) {
      fail(`manifest is missing ${fieldName}.${size}.`);
    }

    return relativePath;
  });
}

const requiredFiles = [
  manifest.action?.default_popup,
  manifest.options_page,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
  ...collectIconFiles(manifest.icons, "icons"),
  ...collectIconFiles(manifest.action?.default_icon, "action.default_icon")
].filter(Boolean);
const contentScriptFiles = (manifest.content_scripts ?? [])
  .flatMap((script) => script.js ?? [])
  .filter(Boolean);
const staticModuleSyntaxPattern = /^\s*(?:import(?:\s|[{"'*])|export(?:\s|[{\*]))/m;

if (manifest.version !== packageJson.version) {
  fail(
    `manifest version ${manifest.version} does not match package version ${packageJson.version}`
  );
}

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
