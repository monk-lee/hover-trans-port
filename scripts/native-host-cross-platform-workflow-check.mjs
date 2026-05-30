import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/native-host-cross-platform.yml";
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
const packageJson = JSON.parse(readRequiredFile(packageJsonPath));

for (const [expected, description] of [
  ["pull_request:", "pull request trigger"],
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
  ["ilammy/msvc-dev-cmd@v1", "Windows ARM64 MSVC setup"],
  ["arch: amd64_arm64", "Windows ARM64 toolchain arch"],
  ["actions/upload-artifact@v4", "dry-run artifact upload"],
  ["build-native-host-release-assets.mjs", "release asset builder"],
  ["hover-trans-port-native-host-macos-0.2.14.tar.gz", "macOS inspect-first package"],
  ["hover-trans-port-native-host-linux-0.2.14.tar.gz", "Linux inspect-first package"],
  ["hover-trans-port-native-host-windows-0.2.14.zip", "Windows inspect-first package"]
]) {
  requireIncludes(workflow, expected, description);
}

requireNotIncludes(workflow, "contents: write", workflowPath);
requireNotIncludes(workflow, "gh release create", workflowPath);
requireNotIncludes(workflow, "push:", workflowPath);

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
