import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexProvider } from "../native-host/src/providers/CodexProvider.mjs";

async function withFakeCodex(scriptBody, callback) {
  const previousOverride = process.env.HOVER_TRANS_PORT_CODEX_PATH;
  const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-codex-models-"));
  const codexPath = join(tempDir, "codex");

  writeFileSync(codexPath, `#!/bin/sh\n${scriptBody}\n`);
  chmodSync(codexPath, 0o755);
  process.env.HOVER_TRANS_PORT_CODEX_PATH = codexPath;

  try {
    return await callback();
  } finally {
    if (previousOverride === undefined) {
      delete process.env.HOVER_TRANS_PORT_CODEX_PATH;
    } else {
      process.env.HOVER_TRANS_PORT_CODEX_PATH = previousOverride;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await withFakeCodex(
  String.raw`
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\n' 'WARNING: ignored object-like text {not json} before model data'
  cat <<'JSON'
{
  "models": [
    { "slug": "gpt-5.5", "display_name": "GPT-5.5", "visibility": "list" },
    { "slug": "gpt-5.4-mini", "display_name": "GPT-5.4 Mini", "visibility": "list" },
    { "slug": "gpt-5.4-nano", "display_name": "GPT-5.4 Nano", "visibility": "hide" }
  ]
}
JSON
  exit 0
fi
exit 1
`,
  async () => {
    const catalog = await new CodexProvider().modelCatalog();

    assert.equal(catalog.source, "cli");
    assert.deepEqual(
      catalog.models.map((model) => model.value),
      ["gpt-5.5", "gpt-5.4-mini"]
    );
  }
);

await withFakeCodex(
  String.raw`
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\n' '{'
  exit 0
fi
exit 1
`,
  async () => {
    const catalog = await new CodexProvider().modelCatalog();
    assert.equal(catalog.source, "fallback");
  }
);
