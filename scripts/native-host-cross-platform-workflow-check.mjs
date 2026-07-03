import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/native-host-cross-platform.yml";
const ciWorkflowPath = ".github/workflows/ci.yml";
const packageJsonPath = "package.json";

function fail(message) {
  console.error(`native-host-cross-platform-workflow-check: ${message}`);
  process.exit(1);
}

function readRequiredFile(filePath) {
  if (!existsSync(filePath)) {
    fail(`${filePath} was not found.`);
  }

  return readFileSync(filePath, "utf8");
}

function requireIncludes(content, expected, description) {
  if (!content.includes(expected)) {
    fail(`${description} must include ${expected}`);
  }
}

function requireNotIncludes(content, unexpected, description) {
  if (content.includes(unexpected)) {
    fail(`${description} must not include ${unexpected}`);
  }
}

const workflow = readRequiredFile(workflowPath);
const ciWorkflow = readRequiredFile(ciWorkflowPath);
const packageJson = JSON.parse(readRequiredFile(packageJsonPath));

for (const [expected, description] of [
  ["workflow_dispatch:", "manual trigger"],
  ["contents: read", "least-privilege permissions"],
  ["installer-smoke:", "installer smoke job"],
  ["runs-on: ${{ matrix.os }}", "OS matrix runner"],
  ["macos-15", "macOS smoke runner"],
  ["ubuntu-latest", "Linux smoke runner"],
  ["windows-latest", "Windows smoke runner"],
  ["cargo build --release --manifest-path native-helper/Cargo.toml", "release helper build"],
  ["node scripts/native-host-installer-smoke.mjs", "installer smoke script"],
  ["release-assets-macos:", "macOS release asset dry-run job"],
  ["release-assets-linux:", "Linux release asset dry-run job"],
  ["release-assets-windows:", "Windows release asset dry-run job"],
  ["aarch64-apple-darwin", "macOS ARM64 target"],
  ["x86_64-apple-darwin", "macOS x64 target"],
  ["x86_64-unknown-linux-gnu", "Linux x64 target"],
  ["aarch64-unknown-linux-gnu", "Linux ARM64 target"],
  ["x86_64-pc-windows-msvc", "Windows x64 target"],
  ["aarch64-pc-windows-msvc", "Windows ARM64 target"],
  ["vcvarsall.bat", "Windows ARM64 MSVC setup"],
  ["amd64_arm64", "Windows ARM64 toolchain arch"],
  ["actions/upload-artifact@v4", "dry-run artifact upload"],
  ["build-native-host-release-assets.mjs", "release asset builder"],
  ["hover-trans-port-native-host-macos-0.2.20.tar.gz", "macOS inspect-first package"],
  ["hover-trans-port-native-host-linux-0.2.20.tar.gz", "Linux inspect-first package"],
  ["hover-trans-port-native-host-windows-0.2.20.zip", "Windows inspect-first package"]
]) {
  requireIncludes(workflow, expected, description);
}

for (const [expected, description] of [
  ["pull_request:", "CI pull request trigger"],
  ["native-host-installer-smoke:", "CI installer smoke job"],
  ["Native host installer smoke ${{ matrix.os }}", "CI installer smoke matrix name"],
  ["macos-15", "CI macOS smoke runner"],
  ["ubuntu-latest", "CI Linux smoke runner"],
  ["windows-latest", "CI Windows smoke runner"],
  ["node scripts/native-host-installer-smoke.mjs", "CI installer smoke script"],
  ["native-host-linux-assets:", "CI Linux release asset job"],
  ["native-host-windows-assets:", "CI Windows release asset job"],
  ["x86_64-unknown-linux-gnu", "CI Linux x64 target"],
  ["aarch64-unknown-linux-gnu", "CI Linux ARM64 target"],
  ["x86_64-pc-windows-msvc", "CI Windows x64 target"],
  ["aarch64-pc-windows-msvc", "CI Windows ARM64 target"],
  ["vcvarsall.bat", "CI Windows ARM64 MSVC setup"],
  ["hover-trans-port-native-host-linux-0.2.20.tar.gz", "CI Linux inspect-first package"],
  ["hover-trans-port-native-host-windows-0.2.20.zip", "CI Windows inspect-first package"]
]) {
  requireIncludes(ciWorkflow, expected, description);
}

requireNotIncludes(workflow, "contents: write", workflowPath);
requireNotIncludes(workflow, "gh release create", workflowPath);
requireNotIncludes(workflow, "push:", workflowPath);
requireNotIncludes(workflow, "pull_request:", workflowPath);
requireNotIncludes(workflow, "ilammy/msvc-dev-cmd", workflowPath);
requireNotIncludes(ciWorkflow, "ilammy/msvc-dev-cmd", ciWorkflowPath);

if (!packageJson.scripts?.["native:installer:smoke"]?.includes("native-host-installer-smoke.mjs")) {
  fail("package.json must expose native:installer:smoke");
}

if (
  !packageJson.scripts?.["native:cross-platform-workflow-check"]?.includes(
    "native-host-cross-platform-workflow-check.mjs"
  )
) {
  fail("package.json must expose native:cross-platform-workflow-check");
}

if (!packageJson.scripts?.verify?.includes("pnpm native:cross-platform-workflow-check")) {
  fail("package.json scripts.verify must include pnpm native:cross-platform-workflow-check");
}

console.log("native-host-cross-platform-workflow-check: workflow is valid.");
