#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build/macos-script-installer"
HOST_VERSION="0.2.21"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-macos-script-installer-release: macOS is required" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64)
    ASSET_NAME="hover-trans-port-helper-macos-arm64"
    ;;
  x86_64)
    ASSET_NAME="hover-trans-port-helper-macos-x64"
    ;;
  *)
    echo "build-macos-script-installer-release: unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

HELPER="$ROOT/native-helper/target/release/hover-trans-port-helper"

cargo build --release --manifest-path "$ROOT/native-helper/Cargo.toml"

rm -rf "$BUILD_DIR"
HOVER_TRANS_PORT_HELPER_ASSET_NAME="$ASSET_NAME" \
  node "$ROOT/scripts/build-native-host-release-assets.mjs" \
    --platform macos \
    --asset "$ASSET_NAME" \
    --helper "$HELPER" \
    --out-dir "$BUILD_DIR"
