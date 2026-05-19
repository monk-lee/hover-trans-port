#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build/macos-script-installer"
HOST_VERSION="0.2.7"
PACKAGE_NAME="hover-trans-port-native-host-macos-$HOST_VERSION"

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
INSTALLER="$ROOT/scripts/install-macos-native-host.sh"
PAYLOAD_DIR="$BUILD_DIR/$PACKAGE_NAME"

cargo build --release --manifest-path "$ROOT/native-helper/Cargo.toml"

rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD_DIR"
cp "$HELPER" "$PAYLOAD_DIR/$ASSET_NAME"
cp "$INSTALLER" "$PAYLOAD_DIR/install-macos-native-host.sh"
chmod 755 "$PAYLOAD_DIR/$ASSET_NAME"
chmod 755 "$PAYLOAD_DIR/install-macos-native-host.sh"

(
  cd "$PAYLOAD_DIR"
  shasum -a 256 "$ASSET_NAME" > checksums.txt
)

cp "$PAYLOAD_DIR/$ASSET_NAME" "$BUILD_DIR/$ASSET_NAME"
cp "$PAYLOAD_DIR/install-macos-native-host.sh" "$BUILD_DIR/install-macos-native-host.sh"
cp "$PAYLOAD_DIR/checksums.txt" "$BUILD_DIR/checksums.txt"

(
  cd "$BUILD_DIR"
  tar -czf "$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"
)

echo "built $PAYLOAD_DIR"
echo "built $BUILD_DIR/$ASSET_NAME"
echo "built $BUILD_DIR/install-macos-native-host.sh"
echo "built $BUILD_DIR/checksums.txt"
echo "built $BUILD_DIR/$PACKAGE_NAME.tar.gz"
