import { existsSync, readFileSync } from "node:fs";

const releaseWorkflowPath = ".github/workflows/release.yml";
const ciWorkflowPath = ".github/workflows/ci.yml";
const releaseAssetBuilderPath = "scripts/build-native-host-release-assets.mjs";

const nativeReleaseAssets = [
  "install.sh",
  "install.ps1",
  "install-windows-native-host.ps1",
  "install-macos-native-host.sh",
  "hover-trans-port-helper-macos-arm64",
  "hover-trans-port-helper-macos-x64",
  "hover-trans-port-helper-linux-arm64",
  "hover-trans-port-helper-linux-x64",
  "hover-trans-port-helper-windows-arm64.exe",
  "hover-trans-port-helper-windows-x64.exe",
  "hover-trans-port-native-host-macos-0.2.14.tar.gz",
  "hover-trans-port-native-host-linux-0.2.14.tar.gz",
  "hover-trans-port-native-host-windows-0.2.14.zip"
];

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

function requireEqualArray(actual, expected, description) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    fail(`${description} mismatch:\nexpected ${expectedJson}\nactual   ${actualJson}`);
  }
}

function readRequiredFile(filePath) {
  if (!existsSync(filePath)) {
    fail(`${filePath} was not found.`);
  }

  return readFileSync(filePath, "utf8");
}

function requireCurrentOfficialActions(content, workflowPath) {
  requireIncludes(content, "actions/checkout@v6", `${workflowPath} checkout v6`);
  requireIncludes(content, "actions/setup-node@v6", `${workflowPath} setup-node v6`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJob(content, jobName) {
  const jobPattern = new RegExp(`^  ${escapeRegExp(jobName)}:\\n`, "m");
  const match = jobPattern.exec(content);
  if (!match) {
    fail(`missing job: ${jobName}`);
  }

  const start = match.index;
  const rest = content.slice(start + match[0].length);
  const nextJobMatch = /^  [A-Za-z0-9_-]+:\n/m.exec(rest);
  return content.slice(start, nextJobMatch ? start + match[0].length + nextJobMatch.index : content.length);
}

function extractNeeds(jobContent) {
  const needsMatch = /^    needs:\n((?:      - .+\n)+)/m.exec(jobContent);
  if (!needsMatch) {
    fail("publish job is missing a needs list");
  }

  return needsMatch[1]
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .sort();
}

function extractRunBlock(jobContent, stepName) {
  const lines = jobContent.split("\n");
  const stepLineIndex = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (stepLineIndex === -1) {
    fail(`missing step: ${stepName}`);
  }

  const runLineIndex = lines.findIndex(
    (line, index) => index > stepLineIndex && line.trim() === "run: |"
  );
  if (runLineIndex === -1) {
    fail(`missing run block for step: ${stepName}`);
  }

  const blockLines = [];
  for (let index = runLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("      - name: ")) {
      break;
    }
    blockLines.push(line.replace(/^ {10}/, ""));
  }

  return blockLines.join("\n");
}

function extractChecksumAssetNames(runBlock) {
  const lines = runBlock.split("\n");
  const shasumIndex = lines.findIndex((line) => line.includes("shasum -a 256"));
  if (shasumIndex === -1) {
    fail("stage step is missing shasum -a 256");
  }

  const assetNames = [];
  for (let index = shasumIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].replace(/\\/g, "").replace(/> checksums\.txt.*/, "").trim();
    if (!line) {
      continue;
    }
    for (const token of line.split(/\s+/)) {
      const assetName = token.replace(/^"|"$/g, "");
      if (assetName.startsWith("install") || assetName.startsWith("hover-trans-port-")) {
        assetNames.push(assetName);
      }
    }
    if (lines[index].includes("> checksums.txt")) {
      break;
    }
  }

  return assetNames.sort();
}

function extractGhReleaseAssetNames(runBlock) {
  const lines = runBlock.split("\n");
  const releaseCreateIndex = lines.findIndex((line) => line.includes("gh release create"));
  if (releaseCreateIndex === -1) {
    fail("publish step is missing gh release create");
  }
  const releaseCreateCommand = lines.slice(releaseCreateIndex).join("\n");
  const assetNames = [];
  for (const match of releaseCreateCommand.matchAll(/\$RELEASE_DIR\/([^"]+)/g)) {
    assetNames.push(match[1]);
  }

  if (releaseCreateCommand.includes("$EXTENSION_ZIP")) {
    assetNames.push("hover-trans-port-extension-${TAG_NAME}.zip");
  }

  return assetNames.sort();
}

const ciWorkflow = readRequiredFile(ciWorkflowPath);
const releaseWorkflow = readRequiredFile(releaseWorkflowPath);
const releaseAssetBuilder = readRequiredFile(releaseAssetBuilderPath);

const requiredSnippets = [
  ["push:", "tag push trigger"],
  ["tags:", "tag trigger list"],
  ['- "v*"', "v* tag pattern"],
  ["contents: write", "release write permission"],
  ["runs-on: macos-15", "macOS ARM64 runner"],
  ["build-extension:", "extension build job"],
  ["build-native-macos:", "macOS native host build job"],
  ["build-native-linux:", "Linux native host build job"],
  ["build-native-windows:", "Windows native host build job"],
  ["needs:", "publish waits for native host artifacts"],
  ["ilammy/msvc-dev-cmd@v1", "Windows ARM64 MSVC developer command prompt"],
  ["arch: amd64_arm64", "Windows ARM64 cross compiler architecture"],
  ["pnpm install --frozen-lockfile", "frozen pnpm install"],
  ["pnpm verify", "full verification before release"],
  ["pnpm build", "extension build"],
  ["build-native-host-release-assets.mjs", "native host release asset build"],
  ['EXTENSION_ZIP="build/release/hover-trans-port-extension-${TAG_NAME}.zip"', "tagged extension zip path"],
  ["zip -qr", "extension zip command"],
  ["install.sh", "unix installer asset"],
  ["install.ps1", "windows installer asset"],
  ["install-windows-native-host.ps1", "canonical windows installer asset"],
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

const publishJob = extractJob(releaseWorkflow, "publish");
const publishNeeds = extractNeeds(publishJob);
requireEqualArray(
  publishNeeds,
  ["build-extension", "build-native-linux", "build-native-macos", "build-native-windows"],
  "publish job dependencies"
);

const stageAssetsRun = extractRunBlock(publishJob, "Stage native host release assets");
const publishReleaseRun = extractRunBlock(publishJob, "Publish release");
const checksumAssetNames = extractChecksumAssetNames(stageAssetsRun);
const expectedChecksumAssets = [
  ...nativeReleaseAssets,
  "hover-trans-port-extension-${TAG_NAME}.zip"
].sort();
requireEqualArray(checksumAssetNames, expectedChecksumAssets, "checksum asset list");

const ghReleaseAssetNames = extractGhReleaseAssetNames(publishReleaseRun);
const expectedGhReleaseAssets = [
  ...nativeReleaseAssets,
  "checksums.txt",
  "hover-trans-port-extension-${TAG_NAME}.zip"
].sort();
requireEqualArray(ghReleaseAssetNames, expectedGhReleaseAssets, "gh release asset list");

for (const assetName of expectedGhReleaseAssets) {
  const exactUploadCount = ghReleaseAssetNames.filter((name) => name === assetName).length;
  if (exactUploadCount !== 1) {
    fail(`expected ${assetName} exactly once in gh release create asset list, found ${exactUploadCount}`);
  }
}

requireIncludes(
  releaseAssetBuilder,
  '["scripts/install-windows-native-host.ps1", "install.ps1", 0o644]',
  "friendly Windows installer copy"
);
requireIncludes(
  releaseAssetBuilder,
  '["scripts/install-windows-native-host.ps1", "install-windows-native-host.ps1", 0o644]',
  "canonical Windows installer copy"
);

console.log("release-workflow-check: release workflow is valid.");
