import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-compat-"));
const tempSharedDir = join(tempDir, "src/shared");
mkdirSync(tempSharedDir, { recursive: true });

try {
  writeFileSync(
    join(tempSharedDir, "nativeHostCompatibility.js"),
    transpile("src/shared/nativeHostCompatibility.ts")
  );

  const moduleUrl = pathToFileURL(
    join(tempSharedDir, "nativeHostCompatibility.js")
  ).href;
  const compatibility = await import(moduleUrl);

  assert.equal(compatibility.REQUIRED_NATIVE_HOST_PROTOCOL_VERSION, 3);
  assert.equal(compatibility.MAX_SUPPORTED_NATIVE_HOST_PROTOCOL_VERSION, 3);

  assert.deepEqual(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: "0.1.0",
      bridgeVersion: "0.1.0-phase5",
      protocolVersion: 3
    }),
    {
      ok: true,
      status: "ready",
      message: "Native Host is compatible."
    }
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: "0.0.9",
      bridgeVersion: "0.0.9",
      protocolVersion: 2
    }).status,
    "updateRequired"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: "9.0.0",
      bridgeVersion: "9.0.0",
      protocolVersion: 4
    }).status,
    "unsupportedNewer"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: "0.1.0",
      bridgeVersion: "0.1.0-phase5",
      protocolVersion: "3"
    }).status,
    "invalidHostInfo"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      bridgeVersion: "0.1.0-phase5",
      protocolVersion: 3
    }).status,
    "invalidHostInfo"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: "0.1.0",
      protocolVersion: 3
    }).status,
    "invalidHostInfo"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility({
      hostVersion: 1,
      bridgeVersion: "0.1.0-phase5",
      protocolVersion: 3
    }).status,
    "invalidHostInfo"
  );

  assert.equal(
    compatibility.evaluateNativeHostCompatibility(null).status,
    "invalidHostInfo"
  );

  console.log("native-host-compatibility-check: compatibility rules are valid.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
