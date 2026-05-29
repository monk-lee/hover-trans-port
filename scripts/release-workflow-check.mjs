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
  ["build-native-macos:", "macOS native host build job"],
  ["build-native-linux:", "Linux native host build job"],
  ["build-native-windows:", "Windows native host build job"],
  ["needs:", "publish waits for native host artifacts"],
  ["pnpm install --frozen-lockfile", "frozen pnpm install"],
  ["pnpm verify", "full verification before release"],
  ["pnpm build", "extension build"],
  ["build-native-host-release-assets.mjs", "native host release asset build"],
  ['EXTENSION_ZIP="build/release/hover-trans-port-extension-${TAG_NAME}.zip"', "tagged extension zip path"],
  ["zip -qr", "extension zip command"],
  ["install.sh", "unix installer asset"],
  ["install.ps1", "windows installer asset"],
  ["install-macos-native-host.sh", "macOS compatibility installer asset"],
  ["checksums.txt", "checksum asset"],
  ["hover-trans-port-helper-macos-arm64", "ARM64 helper asset"],
  ["hover-trans-port-helper-macos-x64", "macOS x64 helper asset"],
  ["hover-trans-port-helper-linux-x64", "linux x64 helper asset"],
  ["hover-trans-port-helper-linux-arm64", "linux arm64 helper asset"],
  ["hover-trans-port-helper-windows-x64.exe", "windows x64 helper asset"],
  ["hover-trans-port-helper-windows-arm64.exe", "windows arm64 helper asset"],
  ["hover-trans-port-native-host-macos-0.2.14.tar.gz", "native host tarball asset"],
  ["hover-trans-port-native-host-linux-0.2.14.tar.gz", "linux native host tarball asset"],
  ["hover-trans-port-native-host-windows-0.2.14.zip", "windows native host zip asset"],
  ["ubuntu-latest", "linux release runner"],
  ["windows-latest", "windows release runner"],
  ["Detects tooltip copy wrapped in inline spans", "inline tooltip release note"],
  ["Keeps tooltip translation scoped to the visible inline text", "visible tooltip text release note"],
  ["Adds release verification for tooltip translation target detection", "tooltip target verification release note"],
  ["Native host update required:", "native host update release note"],
  ["Existing v0.2.4 installs that still report helper version v0.2.3 need one manual install command", "v0.2.4 updater bug release note"],
  ["Existing v0.2.5 and later native hosts can install future releases from Options", "update-capable host release note"],
  ["Existing v0.2.2 and older native hosts do not understand update messages", "manual first update release note"],
  ["Future update-capable native host releases can continue to be installed from Options", "native auto-update next release note"],
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
