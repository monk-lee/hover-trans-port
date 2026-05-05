function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderNativeHostLauncher({ nodePath }) {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
HOST="$ROOT/current/host.mjs"

if [ ! -f "$HOST" ]; then
  echo "hover-trans-port: active native host is not installed" >&2
  exit 1
fi

exec ${shellQuote(nodePath)} "$HOST"
`;
}
