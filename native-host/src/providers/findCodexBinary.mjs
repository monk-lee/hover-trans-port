import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function splitPath(value) {
  return value ? value.split(":").filter(Boolean) : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function findCodexBinary(env = process.env) {
  if (env.HOVER_TRANS_PORT_CODEX_PATH) {
    return isExecutable(env.HOVER_TRANS_PORT_CODEX_PATH)
      ? env.HOVER_TRANS_PORT_CODEX_PATH
      : null;
  }

  const home = homedir();
  const candidates = unique([
    ...splitPath(env.PATH).map((dir) => join(dir, "codex")),
    join(dirname(process.execPath), "codex"),
    join(home, ".local/share/mise/shims/codex"),
    join(home, ".local/share/mise/installs/node/22.22.0/bin/codex"),
    join(home, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex"
  ]);

  return candidates.find(isExecutable) ?? null;
}
