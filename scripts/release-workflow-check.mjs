import { existsSync, readFileSync } from "node:fs";

const releaseWorkflowPath = ".github/workflows/release.yml";
const ciWorkflowPath = ".github/workflows/ci.yml";

function fail(message) {
  console.error(`release-workflow-check: ${message}`);
  process.exit(1);
}

function requireIncludes(content, expected, description) {
  if (!content.includes(expected)) {
    fail(`missing ${description}: ${expected}`);
  }
}

function requireNotIncludes(content, unexpected, description) {
  if (content.includes(unexpected)) {
    fail(`unexpected ${description}: ${unexpected}`);
  }
}

function readWorkflow(workflowPath) {
  if (!existsSync(workflowPath)) {
    fail(`${workflowPath} was not found.`);
  }

  return readFileSync(workflowPath, "utf8");
}

function requireCurrentOfficialActions(content, workflowPath) {
  requireIncludes(content, "actions/checkout@v6", `${workflowPath} checkout v6`);
  requireIncludes(content, "actions/setup-node@v6", `${workflowPath} setup-node v6`);
}

const ciWorkflow = readWorkflow(ciWorkflowPath);
const releaseWorkflow = readWorkflow(releaseWorkflowPath);

const requiredSnippets = [
  ["push:", "tag push trigger"],
  ["tags:", "tag trigger list"],
  ['- "v*"', "v* tag pattern"],
  ["contents: write", "release write permission"],
  ["runs-on: macos-15", "macOS ARM64 runner"],
  ["pnpm install --frozen-lockfile", "frozen pnpm install"],
  ["pnpm verify", "full verification before release"],
  ["pnpm build", "extension build"],
  ["pnpm macos:script-installer:build", "native host release asset build"],
  ['EXTENSION_ZIP="build/release/hover-trans-port-extension-${TAG_NAME}.zip"', "tagged extension zip path"],
  ["zip -qr", "extension zip command"],
  ["install-macos-native-host.sh", "script installer asset"],
  ["checksums.txt", "checksum asset"],
  ["hover-trans-port-helper-macos-arm64", "ARM64 helper asset"],
  ["hover-trans-port-native-host-macos-0.2.2.tar.gz", "native host tarball asset"],
  ["Native host update required:", "native host update release note"],
  ["A future release is planned to add native host/helper auto-update support", "native auto-update roadmap note"],
  ["https://github.com/monk-lee/hover-trans-port", "current GitHub repository owner"],
  ["docs/native-host-install.md", "native install docs link"],
  ["PRIVACY.md", "privacy docs link"],
  ["not a Chrome Web Store release", "Chrome Web Store disclaimer"],
  ["GH_TOKEN: ${{ github.token }}", "GitHub CLI token"],
  ["gh release create", "GitHub release creation"],
  ["--verify-tag", "existing tag verification"],
  ["--latest", "latest release flag"]
];

requireCurrentOfficialActions(ciWorkflow, ciWorkflowPath);
requireCurrentOfficialActions(releaseWorkflow, releaseWorkflowPath);

for (const [snippet, description] of requiredSnippets) {
  requireIncludes(releaseWorkflow, snippet, description);
}

requireNotIncludes(releaseWorkflow, "--prerelease", "prerelease flag");
requireNotIncludes(releaseWorkflow, "dev-monk-lee", "old GitHub repository owner");
requireNotIncludes(releaseWorkflow, "Developer Preview", "developer preview release title");
requireNotIncludes(releaseWorkflow, "developer preview", "developer preview release wording");

console.log("release-workflow-check: release workflow is valid.");
