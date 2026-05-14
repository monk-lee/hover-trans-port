#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.monklabs.hover_trans_port"
DEFAULT_HOST_VERSION="0.2.3"
DEFAULT_EXTENSION_ID="mmbmjpmhmlkjknhcigafgplahdbicabe"
APP_SUPPORT_DIR_NAME="Hover Trans Port"
HELPER_EXECUTABLE_NAME="hover-trans-port-helper"
GITHUB_RELEASE_BASE_URL="https://github.com/monk-lee/hover-trans-port/releases"

COMMAND="install"
HOST_VERSION="$DEFAULT_HOST_VERSION"
RELEASE_TAG="latest"
HELPER_SOURCE=""
SKIP_CHECKSUM="0"
JSON_OUTPUT="0"
PREVIOUS_VERSION=""

usage() {
  cat <<'USAGE'
Usage:
  install-macos-native-host.sh install [--host-version VERSION] [--release-tag TAG] [--helper-source PATH] [--skip-checksum] [--json]
  install-macos-native-host.sh update [--host-version VERSION] [--release-tag TAG] [--helper-source PATH] [--skip-checksum] [--json]
  install-macos-native-host.sh status
  install-macos-native-host.sh uninstall

Environment overrides:
  HOVER_TRANS_PORT_EXTENSION_ID
  HOVER_TRANS_PORT_INSTALL_ROOT
  HOVER_TRANS_PORT_CHROME_NATIVE_HOSTS_DIR
  HOVER_TRANS_PORT_WHALE_NATIVE_HOSTS_DIR
  HOVER_TRANS_PORT_ATLAS_NATIVE_HOSTS_DIR
  HOVER_TRANS_PORT_RELEASE_BASE_URL
USAGE
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    install|update|status|uninstall)
      COMMAND="$1"
      shift
      ;;
  esac
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host-version)
      HOST_VERSION="${2:?--host-version requires a value}"
      shift 2
      ;;
    --release-tag)
      RELEASE_TAG="${2:?--release-tag requires a value}"
      shift 2
      ;;
    --helper-source)
      HELPER_SOURCE="${2:?--helper-source requires a value}"
      shift 2
      ;;
    --skip-checksum)
      SKIP_CHECKSUM="1"
      shift
      ;;
    --json)
      JSON_OUTPUT="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install-macos-native-host: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-macos-native-host: macOS is required" >&2
  exit 1
fi

EXTENSION_ID="${HOVER_TRANS_PORT_EXTENSION_ID:-$DEFAULT_EXTENSION_ID}"
HOME_DIR="${HOME:?HOME is required}"
INSTALL_ROOT="${HOVER_TRANS_PORT_INSTALL_ROOT:-$HOME_DIR/Library/Application Support/$APP_SUPPORT_DIR_NAME}"
CHROME_NATIVE_HOSTS_DIR="${HOVER_TRANS_PORT_CHROME_NATIVE_HOSTS_DIR:-$HOME_DIR/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
WHALE_NATIVE_HOSTS_DIR="${HOVER_TRANS_PORT_WHALE_NATIVE_HOSTS_DIR:-$HOME_DIR/Library/Application Support/Naver/Whale/NativeMessagingHosts}"
ATLAS_NATIVE_HOSTS_DIR="${HOVER_TRANS_PORT_ATLAS_NATIVE_HOSTS_DIR:-$HOME_DIR/Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts}"
MANIFEST_PATHS=(
  "$CHROME_NATIVE_HOSTS_DIR/$HOST_NAME.json"
  "$WHALE_NATIVE_HOSTS_DIR/$HOST_NAME.json"
  "$ATLAS_NATIVE_HOSTS_DIR/$HOST_NAME.json"
)
MANIFEST_PATH="${MANIFEST_PATHS[0]}"
NATIVE_HOSTS_ROOT="$INSTALL_ROOT/native-hosts"
VERSION_DIR="$NATIVE_HOSTS_ROOT/$HOST_VERSION"
CURRENT_LINK="$INSTALL_ROOT/current"
LAUNCHER_PATH="$INSTALL_ROOT/launcher"
RELEASE_BASE_URL="${HOVER_TRANS_PORT_RELEASE_BASE_URL:-$GITHUB_RELEASE_BASE_URL}"

detect_asset_name() {
  case "$(uname -m)" in
    arm64)
      printf '%s\n' "hover-trans-port-helper-macos-arm64"
      ;;
    x86_64)
      printf '%s\n' "hover-trans-port-helper-macos-x64"
      ;;
    *)
      echo "install-macos-native-host: unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

download_url_for() {
  asset_name="$1"
  if [ "$RELEASE_TAG" = "latest" ]; then
    printf '%s\n' "$RELEASE_BASE_URL/latest/download/$asset_name"
  else
    printf '%s\n' "$RELEASE_BASE_URL/download/$RELEASE_TAG/$asset_name"
  fi
}

download_checksums_url() {
  if [ "$RELEASE_TAG" = "latest" ]; then
    printf '%s\n' "$RELEASE_BASE_URL/latest/download/checksums.txt"
  else
    printf '%s\n' "$RELEASE_BASE_URL/download/$RELEASE_TAG/checksums.txt"
  fi
}

copy_helper() {
  source="$1"
  destination="$2"
  cp "$source" "$destination"
  chmod 755 "$destination"
}

remove_if_exists() {
  target="$1"
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target"
  fi
}

json_string() {
  value="$1"
  escaped="$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '"%s"' "$escaped"
}

emit_install_result() {
  if [ "$JSON_OUTPUT" = "1" ]; then
    manifests_json=""
    for manifest_path in "${MANIFEST_PATHS[@]}"; do
      escaped="$(json_string "$manifest_path")"
      if [ -n "$manifests_json" ]; then
        manifests_json="$manifests_json,"
      fi
      manifests_json="$manifests_json$escaped"
    done
    previous_json="$(json_string "$PREVIOUS_VERSION")"
    installed_json="$(json_string "$HOST_VERSION")"
    install_root_json="$(json_string "$INSTALL_ROOT")"
    current_link_json="$(json_string "$CURRENT_LINK")"
    helper_path_json="$(json_string "$VERSION_DIR/$HELPER_EXECUTABLE_NAME")"
    updater_path_json="$(json_string "$VERSION_DIR/install-macos-native-host.sh")"
    printf '{"command":"%s","ok":true,"previousVersion":%s,"installedVersion":%s,"installRoot":%s,"currentLink":%s,"helperPath":%s,"updaterPath":%s,"manifests":[%s]}\n' \
      "$COMMAND" "$previous_json" "$installed_json" "$install_root_json" "$current_link_json" "$helper_path_json" "$updater_path_json" "$manifests_json"
    return
  fi

  echo "installed native host $HOST_VERSION"
  for manifest_path in "${MANIFEST_PATHS[@]}"; do
    echo "manifest: $manifest_path"
  done
  echo "launcher: $LAUNCHER_PATH"
  echo "current: $CURRENT_LINK -> $VERSION_DIR"
}

write_launcher() {
  cat > "$LAUNCHER_PATH" <<'LAUNCHER'
#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
HELPER="$ROOT/current/hover-trans-port-helper"

if [ ! -x "$HELPER" ]; then
  echo "hover-trans-port: active native host is not installed" >&2
  exit 1
fi

exec "$HELPER"
LAUNCHER
  chmod 755 "$LAUNCHER_PATH"
}

write_manifest() {
  for manifest_path in "${MANIFEST_PATHS[@]}"; do
    mkdir -p "$(dirname "$manifest_path")"
    cat > "$manifest_path" <<MANIFEST
{
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ],
  "description": "Hover Trans Port Native Host",
  "name": "$HOST_NAME",
  "path": "$LAUNCHER_PATH",
  "type": "stdio"
}
MANIFEST
  done
}

write_metadata() {
  metadata_path="$1"
  updater_path="$2"
  cat > "$metadata_path" <<METADATA
{
  "hostVersion": "$HOST_VERSION",
  "protocolVersion": 1,
  "source": "macos-script-installer",
  "updaterPath": "$updater_path"
}
METADATA
}

persist_updater_script() {
  destination="$1"
  script_source="${BASH_SOURCE[0]:-$0}"

  if [ -f "$script_source" ] && [ -r "$script_source" ]; then
    cp "$script_source" "$destination"
  else
    updater_url="$(download_url_for "install-macos-native-host.sh")"
    echo "install-macos-native-host: downloading $updater_url" >&2
    curl -fL "$updater_url" -o "$destination"
  fi

  chmod 755 "$destination"
}

clear_quarantine_if_present() {
  target="$1"
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$target" >/dev/null 2>&1 || true
  fi
}

resolve_helper_source() {
  if [ -n "$HELPER_SOURCE" ]; then
    if [ ! -x "$HELPER_SOURCE" ]; then
      echo "install-macos-native-host: helper source is not executable: $HELPER_SOURCE" >&2
      exit 1
    fi
    printf '%s\n' "$HELPER_SOURCE"
    return 0
  fi

  script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  asset_name="$(detect_asset_name)"
  bundled="$script_dir/$asset_name"
  generic_bundled="$script_dir/$HELPER_EXECUTABLE_NAME"

  if [ -x "$bundled" ]; then
    printf '%s\n' "$bundled"
    return 0
  fi

  if [ -x "$generic_bundled" ]; then
    printf '%s\n' "$generic_bundled"
    return 0
  fi

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hover-trans-port-installer.XXXXXX")"
  helper_path="$tmp_dir/$asset_name"
  checksums_path="$tmp_dir/checksums.txt"
  helper_url="$(download_url_for "$asset_name")"

  echo "install-macos-native-host: downloading $helper_url" >&2
  curl -fL "$helper_url" -o "$helper_path"
  chmod 755 "$helper_path"

  if [ "$SKIP_CHECKSUM" != "1" ]; then
    checksums_url="$(download_checksums_url)"
    echo "install-macos-native-host: downloading $checksums_url" >&2
    curl -fL "$checksums_url" -o "$checksums_path"
    (
      cd "$tmp_dir"
      grep "  $asset_name\$" checksums.txt > "$asset_name.sha256"
      shasum -a 256 -c "$asset_name.sha256"
    ) >&2
  fi

  printf '%s\n' "$helper_path"
}

install_helper() {
  helper_source="$(resolve_helper_source)"
  staging_dir="$VERSION_DIR.staging"
  backup_dir="$VERSION_DIR.backup"

  remove_if_exists "$staging_dir"
  remove_if_exists "$backup_dir"
  mkdir -p "$staging_dir"

  copy_helper "$helper_source" "$staging_dir/$HELPER_EXECUTABLE_NAME"
  clear_quarantine_if_present "$staging_dir/$HELPER_EXECUTABLE_NAME"
  updater_path="$staging_dir/install-macos-native-host.sh"
  persist_updater_script "$updater_path"
  write_metadata "$staging_dir/metadata.json" "$VERSION_DIR/install-macos-native-host.sh"

  mkdir -p "$NATIVE_HOSTS_ROOT"
  if [ -e "$VERSION_DIR" ] || [ -L "$VERSION_DIR" ]; then
    mv "$VERSION_DIR" "$backup_dir"
  fi

  if mv "$staging_dir" "$VERSION_DIR"; then
    remove_if_exists "$backup_dir"
  else
    if [ -e "$backup_dir" ] && [ ! -e "$VERSION_DIR" ]; then
      mv "$backup_dir" "$VERSION_DIR"
    fi
    remove_if_exists "$staging_dir"
    exit 1
  fi

  mkdir -p "$INSTALL_ROOT"
  next_link="$CURRENT_LINK.next"
  remove_if_exists "$next_link"
  ln -s "$VERSION_DIR" "$next_link"
  if [ -L "$CURRENT_LINK" ]; then
    current_target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
    PREVIOUS_VERSION="$(basename "$current_target")"
  fi
  remove_if_exists "$CURRENT_LINK"
  mv "$next_link" "$CURRENT_LINK"

  write_launcher
  clear_quarantine_if_present "$LAUNCHER_PATH"
  write_manifest

  emit_install_result
}

all_manifests_exist() {
  for manifest_path in "${MANIFEST_PATHS[@]}"; do
    if [ ! -f "$manifest_path" ]; then
      return 1
    fi
  done
  return 0
}

status_host() {
  if [ -x "$CURRENT_LINK/$HELPER_EXECUTABLE_NAME" ] && all_manifests_exist; then
    resolved="$(readlink "$CURRENT_LINK" 2>/dev/null || printf '%s' "$CURRENT_LINK")"
    installed_version="$(basename "$resolved")"
    echo "installed native host $installed_version"
    for manifest_path in "${MANIFEST_PATHS[@]}"; do
      echo "manifest: $manifest_path"
    done
    echo "current: $CURRENT_LINK -> $resolved"
  else
    echo "not installed"
  fi
}

uninstall_host() {
  for manifest_path in "${MANIFEST_PATHS[@]}"; do
    remove_if_exists "$manifest_path"
  done
  remove_if_exists "$INSTALL_ROOT"
  echo "uninstalled native host"
}

case "$COMMAND" in
  install|update)
    install_helper
    ;;
  status)
    status_host
    ;;
  uninstall)
    uninstall_host
    ;;
  *)
    echo "install-macos-native-host: unsupported command: $COMMAND" >&2
    exit 2
    ;;
esac
