import assert from "node:assert/strict";
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

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-latency-"));
const tempBackgroundDir = join(tempDir, "src/background");
mkdirSync(tempBackgroundDir, { recursive: true });

try {
  writeFileSync(
    join(tempBackgroundDir, "translationInflight.js"),
    transpile("src/background/translationInflight.ts")
  );

  const {
    TranslationInflightRegistry,
    createTranslationInflightKey
  } = await import(
    pathToFileURL(join(tempBackgroundDir, "translationInflight.js")).href
  );

  assert.equal(
    createTranslationInflightKey({
      provider: "codex",
      model: "",
      sourceLang: "auto",
      targetLang: "ko",
      text: "  Hello\n   world  "
    }),
    createTranslationInflightKey({
      provider: "codex",
      model: "default",
      sourceLang: "auto",
      targetLang: "ko",
      text: "Hello world"
    }),
    "inflight key normalizes whitespace and default model"
  );

  const registry = new TranslationInflightRegistry();
  let callCount = 0;
  let joinCount = 0;

  const first = registry.run("same-key", async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, value: "translated" };
  });
  const second = registry.run(
    "same-key",
    async () => {
      callCount += 1;
      return { ok: true, value: "duplicate" };
    },
    () => {
      joinCount += 1;
    }
  );

  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, value: "translated" },
    { ok: true, value: "translated" }
  ]);
  assert.equal(callCount, 1, "duplicate request reuses inflight work");
  assert.equal(joinCount, 1, "duplicate request reports a join");
  assert.equal(registry.size, 0, "completed request is removed");

  await assert.rejects(
    registry.run("failing-key", async () => {
      throw new Error("provider failed");
    }),
    /provider failed/
  );
  assert.equal(registry.size, 0, "failed request is removed");

  const nativeClientTs = readFileSync("src/background/nativeClient.ts", "utf8");
  for (const event of [
    "translation.timeline.background",
    "translation.inflight.start",
    "translation.inflight.joined",
    "translation.inflight.end"
  ]) {
    assert.match(
      nativeClientTs,
      new RegExp(`"${event}"`),
      `${event} is logged`
    );
  }

  for (const removedEvent of [
    "translation.timeline.options_loaded",
    "translation.timeline.host_info_checked",
    "translation.timeline.native_response",
    "translation.inflight.join"
  ]) {
    assert.doesNotMatch(
      nativeClientTs,
      new RegExp(`"${removedEvent}"`),
      `${removedEvent} should not be emitted as a separate native log event`
    );
  }

  console.log("translation-latency-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
