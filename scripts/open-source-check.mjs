import { existsSync, readFileSync } from "node:fs";

function fail(message) {
  console.error(`open-source-check: ${message}`);
  process.exit(1);
}

function read(path) {
  if (!existsSync(path)) {
    fail(`${path} is missing`);
  }
  return readFileSync(path, "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    fail(`${label} is missing ${JSON.stringify(expected)}`);
  }
}

function assertRequiredFiles(paths) {
  for (const path of paths) {
    read(path);
  }
}

assertRequiredFiles([
  "LICENSE",
  "README.md",
  "readmes/README.ko.md",
  "PRIVACY.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs/native-host-install.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
]);

const packageJson = readJson("package.json");

if (packageJson.private === true) {
  fail("package.json private must not be true");
}

if (packageJson.license !== "MIT") {
  fail("package.json license must be MIT");
}

if (!packageJson.repository?.url?.includes("hover-trans-port")) {
  fail("package.json repository.url must include hover-trans-port");
}

if (!packageJson.scripts?.verify?.includes("pnpm open-source:check")) {
  fail("package.json scripts.verify must include pnpm open-source:check");
}

const manifestJson = readJson("public/manifest.json");
const permissions = manifestJson.permissions;

if (!Array.isArray(permissions)) {
  fail("public/manifest.json permissions must be an array");
}

if (permissions.includes("cookies")) {
  fail("public/manifest.json permissions must not include cookies");
}

if (!permissions.includes("nativeMessaging")) {
  fail("public/manifest.json permissions must include nativeMessaging");
}

const readme = read("README.md");
assertIncludes(readme, "developer preview", "README.md");
assertIncludes(readme, "Codex CLI", "README.md");
assertIncludes(readme, "Claude CLI", "README.md");
assertIncludes(readme, "experimental Claude CLI", "README.md");
assertIncludes(readme, "Native Messaging", "README.md");
assertIncludes(readme, "PRIVACY.md", "README.md");
assertIncludes(readme, "[한국어](readmes/README.ko.md)", "README.md");
assertIncludes(
  readme,
  "not affiliated with, endorsed by, or sponsored by OpenAI, Codex, Anthropic, or Claude",
  "README.md"
);

const koreanReadme = read("readmes/README.ko.md");
assertIncludes(koreanReadme, "[English](../README.md)", "Korean README");
assertIncludes(
  koreanReadme,
  "이 한국어 README는 빠른 이해를 위한 요약입니다.",
  "Korean README"
);
assertIncludes(koreanReadme, "../PRIVACY.md", "Korean README");
assertIncludes(koreanReadme, "../SECURITY.md", "Korean README");
assertIncludes(koreanReadme, "../docs/native-host-install.md", "Korean README");
assertIncludes(koreanReadme, "Claude CLI", "Korean README");
assertIncludes(
  koreanReadme,
  "OpenAI, Codex, Anthropic, Claude와 제휴, 보증, 후원을 받는 공식 제품이 아닙니다.",
  "Korean README"
);

const privacy = read("PRIVACY.md");
assertIncludes(
  privacy,
  "Codex CLI and experimental Claude CLI",
  "PRIVACY.md"
);
assertIncludes(
  privacy,
  "does not store provider credentials or API keys",
  "may send requested text upstream",
  "PRIVACY.md"
);
assertIncludes(privacy, "does not request the `cookies` permission", "PRIVACY.md");
assertIncludes(privacy, "~/.hover-trans-port/cache.sqlite", "PRIVACY.md");
assertIncludes(privacy, "plaintext SQLite", "PRIVACY.md");

const security = read("SECURITY.md");
assertIncludes(security, "Chrome Native Messaging", "SECURITY.md");
assertIncludes(security, "read-only sandbox", "SECURITY.md");
assertIncludes(security, "private vulnerability reporting", "SECURITY.md");

const nativeHostInstall = read("docs/native-host-install.md");
assertIncludes(nativeHostInstall, "developer preview", "docs/native-host-install.md");
assertIncludes(nativeHostInstall, "pnpm native:install", "docs/native-host-install.md");
assertIncludes(nativeHostInstall, "pnpm native:uninstall", "docs/native-host-install.md");
assertIncludes(nativeHostInstall, "Target language", "docs/native-host-install.md");
assertIncludes(
  nativeHostInstall,
  "per-request provider CLI timeout",
  "docs/native-host-install.md"
);
assertIncludes(nativeHostInstall, "standalone modifier keys", "docs/native-host-install.md");
assertIncludes(nativeHostInstall, "ChatGPT Atlas", "docs/native-host-install.md");
assertIncludes(
  nativeHostInstall,
  "Experimental Claude CLI",
  "docs/native-host-install.md"
);
assertIncludes(
  nativeHostInstall,
  "Claude authentication is verified by Claude CLI when a translation runs",
  "docs/native-host-install.md"
);

const optionsHtml = read("src/options.html");
assertIncludes(optionsHtml, "Trigger not working?", "src/options.html");
assertIncludes(optionsHtml, "Record another key combination.", "src/options.html");

console.log("open-source-check: public release disclosures are present.");
