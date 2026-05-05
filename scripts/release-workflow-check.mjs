import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/release.yml";

function fail(message) {
  console.error(`release-workflow-check: ${message}`);
  process.exit(1);
}

function requireIncludes(content, expected, description) {
  if (!content.includes(expected)) {
    fail(`missing ${description}: ${expected}`);
  }
}

if (!existsSync(workflowPath)) {
  fail(`${workflowPath} was not found.`);
}

const workflow = readFileSync(workflowPath, "utf8");

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
  ["hover-trans-port-native-host-macos-0.1.0.tar.gz", "native host tarball asset"],
  ["docs/native-host-install.md", "native install docs link"],
  ["PRIVACY.md", "privacy docs link"],
  ["not a Chrome Web Store release", "Chrome Web Store disclaimer"],
  ["GH_TOKEN: ${{ github.token }}", "GitHub CLI token"],
  ["gh release create", "GitHub release creation"],
  ["--verify-tag", "existing tag verification"],
  ["--prerelease", "prerelease flag"]
];

for (const [snippet, description] of requiredSnippets) {
  requireIncludes(workflow, snippet, description);
}

console.log("release-workflow-check: release workflow is valid.");
