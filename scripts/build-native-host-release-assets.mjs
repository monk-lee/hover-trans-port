#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedPlatforms = new Set(["macos", "linux", "windows"]);
const supportedHelperAssetsByPlatform = new Map([
  [
    "macos",
    new Set([
      "hover-trans-port-helper-macos-arm64",
      "hover-trans-port-helper-macos-x64"
    ])
  ],
  [
    "linux",
    new Set([
      "hover-trans-port-helper-linux-arm64",
      "hover-trans-port-helper-linux-x64"
    ])
  ],
  [
    "windows",
    new Set([
      "hover-trans-port-helper-windows-arm64.exe",
      "hover-trans-port-helper-windows-x64.exe"
    ])
  ]
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/build-native-host-release-assets.mjs --platform PLATFORM --asset ASSET_NAME --helper HELPER_PATH [--out-dir DIR]",
    "",
    "Environment:",
    "  HOVER_TRANS_PORT_HELPER_ASSET_NAME may be used instead of --asset."
  ].join("\n");
}

function fail(message) {
  console.error(`build-native-host-release-assets: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`unexpected argument: ${arg}\n${usage()}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${arg} requires a value\n${usage()}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function resolveFromRoot(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath);
}

async function assertFile(filePath, description) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      fail(`${description} is not a file: ${filePath}`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`${description} was not found: ${filePath}`);
    }
    throw error;
  }
}

async function copyReleaseFile(sourcePath, destinationPath, mode) {
  await copyFile(sourcePath, destinationPath);
  if (process.platform !== "win32") {
    await chmod(destinationPath, mode);
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}`);
  }
}

function createArchive(platform, outDir, packageName, archiveName) {
  if (platform === "windows") {
    if (process.platform === "win32") {
      run(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Compress-Archive -Path '${packageName}' -DestinationPath '${archiveName}' -Force`
        ],
        { cwd: outDir }
      );
      return;
    }

    run("zip", ["-qr", archiveName, packageName], { cwd: outDir });
    return;
  }

  run("tar", ["-czf", archiveName, packageName], { cwd: outDir });
}

function expectedHelperAssets(platform) {
  return supportedHelperAssetsByPlatform.get(platform) ?? new Set();
}

function validateHelperAssetName(platform, assetName) {
  if (
    assetName !== path.basename(assetName) ||
    assetName.includes("/") ||
    assetName.includes("\\") ||
    assetName.includes("\0") ||
    assetName.includes("..")
  ) {
    fail(`invalid helper asset name: ${assetName}`);
  }

  if (!expectedHelperAssets(platform).has(assetName)) {
    fail(`unsupported ${platform} helper asset: ${assetName}`);
  }
}

function assertInsideDirectory(parentDir, childPath, description) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${description} must stay inside output directory: ${childPath}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.platform;
  const assetName = args.asset ?? process.env.HOVER_TRANS_PORT_HELPER_ASSET_NAME;
  const helperPath = args.helper ? resolveFromRoot(args.helper) : "";

  if (!supportedPlatforms.has(platform)) {
    fail(`unsupported platform: ${platform}\n${usage()}`);
  }

  if (!assetName) {
    fail(`--asset or HOVER_TRANS_PORT_HELPER_ASSET_NAME is required\n${usage()}`);
  }

  validateHelperAssetName(platform, assetName);

  if (!helperPath) {
    fail(`--helper is required\n${usage()}`);
  }

  await assertFile(helperPath, "helper");

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  const outDir = resolveFromRoot(
    args["out-dir"] ?? path.join("build", "native-host-release-assets", platform)
  );
  const packageName = `hover-trans-port-native-host-${platform}-${version}`;
  const archiveName =
    platform === "windows" ? `${packageName}.zip` : `${packageName}.tar.gz`;
  const packageDir = path.join(outDir, packageName);

  await mkdir(outDir, { recursive: true });

  const installerCopies = [
    ["scripts/install.sh", "install.sh", 0o755],
    ["scripts/install-windows-native-host.ps1", "install.ps1", 0o644],
    ["scripts/install-windows-native-host.ps1", "install-windows-native-host.ps1", 0o644],
    ["scripts/install-macos-native-host.sh", "install-macos-native-host.sh", 0o755]
  ];

  for (const [source, destination, mode] of installerCopies) {
    await copyReleaseFile(
      path.join(root, source),
      path.join(outDir, destination),
      mode
    );
  }

  const helperDestination = path.join(outDir, assetName);
  assertInsideDirectory(outDir, helperDestination, "helper asset destination");
  await copyReleaseFile(helperPath, helperDestination, 0o755);

  const helperAssets = (await readdir(outDir))
    .filter((entry) => expectedHelperAssets(platform).has(entry))
    .sort();
  const checksumFiles = [
    "install.sh",
    "install.ps1",
    "install-windows-native-host.ps1",
    "install-macos-native-host.sh",
    ...helperAssets
  ];
  const checksumLines = [];

  for (const fileName of checksumFiles) {
    checksumLines.push(`${await sha256(path.join(outDir, fileName))}  ${fileName}`);
  }

  await writeFile(path.join(outDir, "checksums.txt"), `${checksumLines.join("\n")}\n`);

  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });
  for (const fileName of [...checksumFiles, "checksums.txt"]) {
    await copyFile(path.join(outDir, fileName), path.join(packageDir, fileName));
  }

  await rm(path.join(outDir, archiveName), { force: true });
  createArchive(platform, outDir, packageName, archiveName);

  const outputFiles = [
    ...checksumFiles,
    "checksums.txt",
    archiveName
  ];
  for (const fileName of outputFiles) {
    console.log(`built ${path.join(outDir, fileName)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
