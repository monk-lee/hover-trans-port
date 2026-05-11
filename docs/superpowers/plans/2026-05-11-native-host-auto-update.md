# Native Host Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add macOS native host/helper update checks and user-confirmed in-app updates without silently replacing local binaries.

**Architecture:** The extension schedules and displays update checks, but all native binary installation remains inside the native host/update script boundary. The native helper exposes two narrow update messages, runs only a persisted updater script with fixed arguments, and returns structured JSON results. Options shows stored background check state, lets the user check immediately, and enables installation only after an eligible update is known.

**Tech Stack:** Chrome MV3, TypeScript, Rust native helper, Bash installer, GitHub Releases, existing `pnpm verify` validation scripts.

---

## File Structure

Create:

- `native-helper/src/update.rs`
  Resolves eligible GitHub Releases, compares semantic versions, reads installed updater metadata, invokes the persisted updater with fixed arguments, and returns structured Rust results.

- `scripts/native-host-update-check.mjs`
  Static and lightweight behavior check for update protocol wiring, Options controls, alarm scheduling, storage keys, and manifest permissions.

Modify:

- `docs/superpowers/specs/2026-05-11-native-host-auto-update-design.md`
  Keep the design aligned with background update checks plus user-confirmed installation.

- `scripts/install-macos-native-host.sh`
  Add `--json`, persist a versioned updater script, enrich `metadata.json`, and keep human output unchanged unless JSON mode is requested.

- `scripts/macos-script-installer-check.mjs`
  Add installer tests for persisted updater metadata, JSON output, and update result parsing.

- `native-helper/src/lib.rs`
  Export the new `update` module.

- `native-helper/src/messages.rs`
  Add update request structs and update error code constants if kept centralized.

- `native-helper/src/bridge.rs`
  Route `NATIVE_HOST_UPDATE_STATUS` and `NATIVE_HOST_UPDATE`.

- `native-helper/tests/bridge_tests.rs`
  Add bridge tests for update status, unsupported platform or missing updater failures, and successful updater invocation using fixtures.

- `src/shared/nativeProtocol.ts`
  Add native update request/response types and update error codes.

- `src/shared/messages.ts`
  Add extension message/response types for checking update status, applying update, and returning stored update state.

- `src/shared/options.ts`
  Add `nativeHostUpdateAutoCheck` default and normalizer.

- `src/background/nativeClient.ts`
  Add native update status/update client functions and response validation.

- `src/background/service-worker.ts`
  Add alarm scheduling, stale-result checks, storage updates, and message handlers.

- `src/options.html`
  Add native host update status text, auto-check toggle, check button, and update button inside Diagnostics > Native Host.

- `src/options/main.ts`
  Load stored update state, toggle auto-check, check for updates, run updates after user click, and rerun `Check Native Host` after update.

- `src/options/options.css`
  Add small layout rules for the native host update controls inside the existing diagnostics section.

- `public/manifest.json`
  Add the `alarms` permission for daily background update checks.

- `package.json`
  Add `native-host-update:check` to `verify`.

- `docs/native-host-install.md`
  Document the one-time manual update requirement for pre-update-capable hosts and the later Options update flow.

---

## Task 1: Installer JSON Output And Persisted Updater

**Files:**

- Modify: `scripts/install-macos-native-host.sh`
- Modify: `scripts/macos-script-installer-check.mjs`

- [ ] **Step 1: Write failing installer tests**

Add helper functions to `scripts/macos-script-installer-check.mjs`:

```js
function runJson(args, env) {
  return JSON.parse(run(args.concat("--json"), env));
}

function readMetadata(installRoot, version) {
  return readJson(join(installRoot, "native-hosts", version, "metadata.json"));
}
```

Add these assertions to the existing install test block after `installedHelper` exists:

```js
const metadata = readMetadata(installRoot, "0.2.2");
assert(metadata.hostVersion === "0.2.2", "metadata should name host version");
assert(metadata.protocolVersion === 1, "metadata should name protocol version");
assert(metadata.source === "macos-script-installer", "metadata should name installer source");
assert(metadata.updaterPath === join(versionDir, "install-macos-native-host.sh"), "metadata should name updater path");
assert(existsSync(metadata.updaterPath), "version directory should contain updater script");
assert((lstatSync(metadata.updaterPath).mode & 0o111) !== 0, "updater script should be executable");
```

Add a new JSON-mode block:

```js
withTempRoot("json-update", (root) => {
  const env = makeEnv(root);
  const helperV1 = makeFixtureHelper(root, "json-v1");
  const helperV2 = makeFixtureHelper(root, "json-v2");

  const install = runJson(["install", "--host-version", "0.1.0", "--helper-source", helperV1], env);
  assert(install.ok === true, "json install should report ok");
  assert(install.command === "install", "json install should name command");
  assert(install.installedVersion === "0.1.0", "json install should name installed version");
  assert(Array.isArray(install.manifests), "json install should list manifests");

  const update = runJson(["update", "--host-version", "0.2.2", "--helper-source", helperV2], env);
  assert(update.ok === true, "json update should report ok");
  assert(update.command === "update", "json update should name command");
  assert(update.previousVersion === "0.1.0", "json update should name previous version");
  assert(update.installedVersion === "0.2.2", "json update should name installed version");
  assert(update.currentLink.endsWith("Hover Trans Port/current"), "json update should name current link");
});
```

- [ ] **Step 2: Run the installer test and confirm it fails**

Run:

```bash
pnpm macos:script-installer:test
```

Expected: FAIL because `metadata.updaterPath` is missing and `--json` is rejected as an unknown argument.

- [ ] **Step 3: Add installer argument parsing for JSON mode**

In `scripts/install-macos-native-host.sh`, add state near the existing globals:

```bash
JSON_OUTPUT="0"
PREVIOUS_VERSION=""
```

Add argument parsing:

```bash
--json)
  JSON_OUTPUT="1"
  shift
  ;;
```

Add a JSON string helper for filesystem paths and version strings:

```bash
json_string() {
  value="$1"
  escaped="$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '"%s"' "$escaped"
}
```

Add an output helper:

```bash
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
```

- [ ] **Step 4: Persist the updater script and metadata**

Add a function:

```bash
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
```

Change `write_metadata` to include `updaterPath`:

```bash
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
```

In `install_helper`, before `write_metadata`, call:

```bash
updater_path="$staging_dir/install-macos-native-host.sh"
persist_updater_script "$updater_path"
write_metadata "$staging_dir/metadata.json" "$VERSION_DIR/install-macos-native-host.sh"
```

Set `PREVIOUS_VERSION` before replacing an existing `current` link:

```bash
if [ -L "$CURRENT_LINK" ]; then
  current_target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
  PREVIOUS_VERSION="$(basename "$current_target")"
fi
```

Replace the final human output block in `install_helper` with:

```bash
emit_install_result
```

- [ ] **Step 5: Run installer test and full verification**

Run:

```bash
pnpm macos:script-installer:test
pnpm test
```

Expected: both commands pass.

- [ ] **Step 6: Commit installer work**

```bash
git add scripts/install-macos-native-host.sh scripts/macos-script-installer-check.mjs
git commit -m "feat: persist native host updater"
```

---

## Task 2: Native Helper Update Protocol

**Files:**

- Create: `native-helper/src/update.rs`
- Modify: `native-helper/src/lib.rs`
- Modify: `native-helper/src/messages.rs`
- Modify: `native-helper/src/bridge.rs`
- Modify: `native-helper/tests/bridge_tests.rs`

- [ ] **Step 1: Write failing bridge tests for update status**

Add this helper to `native-helper/tests/bridge_tests.rs`:

```rust
fn write_release_fixture(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
}
```

Add this test:

```rust
#[test]
fn native_host_update_status_reports_available_release() {
    let temp = tempdir().unwrap();
    let releases_path = temp.path().join("releases.json");
    write_release_fixture(
        &releases_path,
        r#"[{
          "tag_name": "v0.2.3",
          "prerelease": false,
          "draft": false,
          "html_url": "https://github.com/monk-lee/hover-trans-port/releases/tag/v0.2.3",
          "assets": [
            {"name": "install-macos-native-host.sh"},
            {"name": "checksums.txt"},
            {"name": "hover-trans-port-helper-macos-arm64"}
          ]
        }]"#,
    );

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
        releases_path.to_string_lossy().into_owned(),
    );
    env.insert("HOVER_TRANS_PORT_TEST_ARCH".to_string(), "arm64".to_string());
    env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

    let response = handle_request(
        json!({"type":"NATIVE_HOST_UPDATE_STATUS","requestId":"req-update-status"}),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_STATUS_RESULT");
    assert_eq!(response["requestId"], "req-update-status");
    assert_eq!(response["ok"], true);
    assert_eq!(response["installedVersion"], "0.2.2");
    assert_eq!(response["latestVersion"], "0.2.3");
    assert_eq!(response["latestTag"], "v0.2.3");
    assert_eq!(response["updateAvailable"], true);
}
```

- [ ] **Step 2: Write failing bridge tests for update execution**

Add this test:

```rust
#[test]
fn native_host_update_invokes_persisted_updater() {
    let temp = tempdir().unwrap();
    let install_root = temp.path().join("Hover Trans Port");
    let current_dir = install_root.join("native-hosts/0.2.2");
    fs::create_dir_all(&current_dir).unwrap();

    let updater_path = current_dir.join("install-macos-native-host.sh");
    fs::write(
        &updater_path,
        "#!/bin/sh\nprintf '%s\n' '{\"command\":\"update\",\"ok\":true,\"previousVersion\":\"0.2.2\",\"installedVersion\":\"0.2.3\",\"installRoot\":\"/tmp/install\",\"currentLink\":\"/tmp/install/current\",\"helperPath\":\"/tmp/install/native-hosts/0.2.3/hover-trans-port-helper\",\"updaterPath\":\"/tmp/install/native-hosts/0.2.3/install-macos-native-host.sh\",\"manifests\":[]}'\n",
    )
    .unwrap();
    make_executable(&updater_path);

    fs::write(
        current_dir.join("metadata.json"),
        format!(
            "{{\"hostVersion\":\"0.2.2\",\"protocolVersion\":1,\"source\":\"macos-script-installer\",\"updaterPath\":\"{}\"}}",
            updater_path.display()
        ),
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_INSTALL_ROOT".to_string(),
        install_root.to_string_lossy().into_owned(),
    );

    let response = handle_request(
        json!({
            "type":"NATIVE_HOST_UPDATE",
            "requestId":"req-update",
            "targetTag":"v0.2.3",
            "targetVersion":"0.2.3"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_RESULT");
    assert_eq!(response["requestId"], "req-update");
    assert_eq!(response["ok"], true);
    assert_eq!(response["previousVersion"], "0.2.2");
    assert_eq!(response["installedVersion"], "0.2.3");
}
```

- [ ] **Step 3: Run bridge tests and confirm they fail**

Run:

```bash
cargo test --manifest-path native-helper/Cargo.toml native_host_update
```

Expected: FAIL because the bridge still returns `UNSUPPORTED_MESSAGE`.

- [ ] **Step 4: Add update request structs**

In `native-helper/src/messages.rs`, add:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostUpdateRequest {
    pub request_id: String,
    pub target_tag: String,
    pub target_version: String,
}
```

- [ ] **Step 5: Implement `native-helper/src/update.rs`**

Create the module with these public entry points:

```rust
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateStatus {
    pub installed_version: String,
    pub latest_version: String,
    pub latest_tag: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateInstallResult {
    pub previous_version: String,
    pub installed_version: String,
    pub installed_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateFailure {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseEntry {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    html_url: String,
    assets: Vec<ReleaseAsset>,
}

pub fn check_update(env: &BTreeMap<String, String>, installed_version: &str) -> Result<UpdateStatus, UpdateFailure> {
    let os = env
        .get("HOVER_TRANS_PORT_TEST_OS")
        .cloned()
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    if os != "macos" {
        return Err(UpdateFailure {
            code: "UPDATE_UNSUPPORTED_PLATFORM",
            message: "Native host updates are currently supported on macOS only.".to_string(),
            retryable: false,
        });
    }

    let releases = load_releases(env)?;
    let helper_asset = helper_asset_name(env)?;
    let latest = releases
        .into_iter()
        .filter(|release| !release.prerelease && !release.draft)
        .filter(|release| has_asset(release, "install-macos-native-host.sh"))
        .filter(|release| has_asset(release, "checksums.txt"))
        .filter(|release| has_asset(release, &helper_asset))
        .max_by(|left, right| version_key(&left.tag_name).cmp(&version_key(&right.tag_name)))
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: "No eligible native host release was found.".to_string(),
            retryable: true,
        })?;

    let latest_version = latest.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateStatus {
        installed_version: installed_version.to_string(),
        latest_version: latest_version.clone(),
        latest_tag: latest.tag_name,
        update_available: version_key(&latest_version) > version_key(installed_version),
        release_url: latest.html_url,
    })
}

fn load_releases(env: &BTreeMap<String, String>) -> Result<Vec<ReleaseEntry>, UpdateFailure> {
    if let Some(path) = env.get("HOVER_TRANS_PORT_RELEASES_JSON_PATH") {
        let body = fs::read_to_string(path).map_err(|error| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: error.to_string(),
            retryable: true,
        })?;
        return serde_json::from_str(&body).map_err(|error| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: error.to_string(),
            retryable: true,
        });
    }

    Err(UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: "Release metadata source was not configured.".to_string(),
        retryable: true,
    })
}

fn helper_asset_name(env: &BTreeMap<String, String>) -> Result<String, UpdateFailure> {
    let arch = env
        .get("HOVER_TRANS_PORT_TEST_ARCH")
        .cloned()
        .unwrap_or_else(|| std::env::consts::ARCH.to_string());

    match arch.as_str() {
        "arm64" | "aarch64" => Ok("hover-trans-port-helper-macos-arm64".to_string()),
        "x86_64" => Ok("hover-trans-port-helper-macos-x64".to_string()),
        other => Err(UpdateFailure {
            code: "UPDATE_UNSUPPORTED_PLATFORM",
            message: format!("Unsupported macOS architecture: {other}"),
            retryable: false,
        }),
    }
}

fn has_asset(release: &ReleaseEntry, asset_name: &str) -> bool {
    release.assets.iter().any(|asset| asset.name == asset_name)
}

fn version_key(version: &str) -> (u64, u64, u64) {
    let clean = version.trim_start_matches('v');
    let mut parts = clean.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}
```

Continue the same file with update execution:

```rust
pub fn run_update(
    env: &BTreeMap<String, String>,
    target_tag: &str,
    target_version: &str,
) -> Result<UpdateInstallResult, UpdateFailure> {
    let metadata = read_active_metadata(env)?;
    let updater_path = metadata
        .get("updaterPath")
        .and_then(Value::as_str)
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: "Installed native host does not include an updater path.".to_string(),
            retryable: false,
        })?;

    let output = crate::process::run_process(crate::process::ProcessRequest {
        executable: PathBuf::from(updater_path),
        args: vec![
            "update".to_string(),
            "--release-tag".to_string(),
            target_tag.to_string(),
            "--host-version".to_string(),
            target_version.to_string(),
            "--json".to_string(),
        ],
        cwd: None,
        env: env.clone(),
        stdin: String::new(),
        timeout_ms: 120_000,
    })
    .map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: error.to_string(),
        retryable: true,
    })?;

    let value: Value = serde_json::from_str(output.stdout.trim()).map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: error.to_string(),
        retryable: true,
    })?;

    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Native host update failed.")
                .to_string(),
            retryable: true,
        });
    }

    Ok(UpdateInstallResult {
        previous_version: value
            .get("previousVersion")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        installed_version: value
            .get("installedVersion")
            .and_then(Value::as_str)
            .unwrap_or(target_version)
            .to_string(),
        installed_path: value
            .get("helperPath")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

fn read_active_metadata(env: &BTreeMap<String, String>) -> Result<Value, UpdateFailure> {
    let install_root = env
        .get("HOVER_TRANS_PORT_INSTALL_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            dirs::home_dir().map(|home| {
                home.join("Library")
                    .join("Application Support")
                    .join("Hover Trans Port")
            })
        })
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: "Could not resolve native host install root.".to_string(),
            retryable: false,
        })?;
    let metadata_path = install_root.join("current").join("metadata.json");
    let body = fs::read_to_string(&metadata_path).map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: error.to_string(),
        retryable: false,
    })?;
    serde_json::from_str(&body).map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: error.to_string(),
        retryable: false,
    })
}
```

- [ ] **Step 6: Wire the bridge**

In `native-helper/src/lib.rs`, add:

```rust
pub mod update;
```

In `native-helper/src/bridge.rs`, import `NativeHostUpdateRequest` and route messages:

```rust
Some("NATIVE_HOST_UPDATE_STATUS") => native_host_update_status(request_id, deps),
Some("NATIVE_HOST_UPDATE") => native_host_update(value, request_id, deps),
```

Add response helpers:

```rust
fn native_host_update_status(request_id: Option<String>, deps: BridgeDeps) -> Value {
    match crate::update::check_update(&deps.env, NATIVE_HOST_VERSION) {
        Ok(status) => json!({
            "type": "NATIVE_HOST_UPDATE_STATUS_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": true,
            "installedVersion": status.installed_version,
            "latestVersion": status.latest_version,
            "latestTag": status.latest_tag,
            "updateAvailable": status.update_available,
            "releaseUrl": status.release_url
        }),
        Err(error) => json!({
            "type": "NATIVE_HOST_UPDATE_STATUS_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": error.code,
            "message": error.message,
            "retryable": error.retryable
        }),
    }
}

fn native_host_update(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<NativeHostUpdateRequest>(value);
    let Ok(request) = request else {
        return json!({
            "type": "NATIVE_HOST_UPDATE_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "NATIVE_HOST_UPDATE message is missing required fields.",
            "retryable": false
        });
    };

    match crate::update::run_update(&deps.env, &request.target_tag, &request.target_version) {
        Ok(result) => json!({
            "type": "NATIVE_HOST_UPDATE_RESULT",
            "requestId": request.request_id,
            "ok": true,
            "previousVersion": result.previous_version,
            "installedVersion": result.installed_version,
            "installedPath": result.installed_path
        }),
        Err(error) => json!({
            "type": "NATIVE_HOST_UPDATE_RESULT",
            "requestId": request.request_id,
            "ok": false,
            "error": error.code,
            "message": error.message,
            "retryable": error.retryable
        }),
    }
}
```

- [ ] **Step 7: Run helper tests**

Run:

```bash
cargo test --manifest-path native-helper/Cargo.toml native_host_update
cargo test --manifest-path native-helper/Cargo.toml
```

Expected: both commands pass.

- [ ] **Step 8: Commit native helper protocol work**

```bash
git add native-helper/src/update.rs native-helper/src/lib.rs native-helper/src/messages.rs native-helper/src/bridge.rs native-helper/tests/bridge_tests.rs
git commit -m "feat: add native host update protocol"
```

---

## Task 3: Extension Protocol, Scheduler, And Storage

**Files:**

- Modify: `public/manifest.json`
- Modify: `src/shared/nativeProtocol.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/shared/options.ts`
- Modify: `src/background/nativeClient.ts`
- Modify: `src/background/service-worker.ts`
- Create: `scripts/native-host-update-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing static check script**

Create `scripts/native-host-update-check.mjs`:

```js
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`native-host-update-check: ${message}`);
  process.exit(1);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    fail(`${label} is missing ${JSON.stringify(expected)}`);
  }
}

const manifest = JSON.parse(read("public/manifest.json"));
if (!manifest.permissions.includes("alarms")) {
  fail("public/manifest.json must include alarms permission");
}

const nativeProtocol = read("src/shared/nativeProtocol.ts");
assertIncludes(nativeProtocol, 'type: "NATIVE_HOST_UPDATE_STATUS"', "native protocol update status request");
assertIncludes(nativeProtocol, 'type: "NATIVE_HOST_UPDATE_RESULT"', "native protocol update result");
assertIncludes(nativeProtocol, '"UPDATE_CHECK_FAILED"', "native update error code");

const messages = read("src/shared/messages.ts");
assertIncludes(messages, 'type: "CHECK_NATIVE_HOST_UPDATE"', "extension update check request");
assertIncludes(messages, 'type: "UPDATE_NATIVE_HOST"', "extension update apply request");
assertIncludes(messages, 'type: "NATIVE_HOST_UPDATE_STATUS"', "extension update status response");

const options = read("src/shared/options.ts");
assertIncludes(options, "DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK", "update auto-check default");
assertIncludes(options, "normalizeNativeHostUpdateAutoCheck", "update auto-check normalizer");

const nativeClient = read("src/background/nativeClient.ts");
assertIncludes(nativeClient, "checkNativeHostUpdateStatus", "background update check client");
assertIncludes(nativeClient, "updateNativeHost", "background update apply client");

const serviceWorker = read("src/background/service-worker.ts");
assertIncludes(serviceWorker, "chrome.alarms.create", "update alarm creation");
assertIncludes(serviceWorker, "native-host-update-check", "update alarm name");
assertIncludes(serviceWorker, "hoverTransPortNativeHostUpdate", "update storage key");

console.log("native-host-update-check: ok");
```

Add the script to `package.json`:

```json
"native-host-update:check": "node scripts/native-host-update-check.mjs"
```

Add it to `verify` after `native:paths-check`:

```json
"pnpm native-host-update:check"
```

- [ ] **Step 2: Run the new check and confirm it fails**

Run:

```bash
pnpm native-host-update:check
```

Expected: FAIL because `alarms`, update types, update clients, and storage wiring do not exist yet.

- [ ] **Step 3: Add manifest permission and option normalizer**

In `public/manifest.json`, add `"alarms"` to `permissions`.

In `src/shared/options.ts`, add:

```ts
export const DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK = true;
```

Extend `HoverTransPortOptions`:

```ts
nativeHostUpdateAutoCheck?: boolean;
```

Add:

```ts
export function normalizeNativeHostUpdateAutoCheck(
  enabled: boolean | undefined
): boolean {
  return typeof enabled === "boolean"
    ? enabled
    : DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK;
}
```

- [ ] **Step 4: Add TypeScript protocol types**

In `src/shared/nativeProtocol.ts`, add request types:

```ts
export type NativeHostUpdateStatusRequest = {
  type: "NATIVE_HOST_UPDATE_STATUS";
  requestId: string;
};

export type NativeHostUpdateRequest = {
  type: "NATIVE_HOST_UPDATE";
  requestId: string;
  targetTag: string;
  targetVersion: string;
};
```

Add error type:

```ts
export type NativeHostUpdateErrorCode =
  | "UPDATE_UNSUPPORTED_PLATFORM"
  | "UPDATE_CHECK_FAILED"
  | "UPDATE_NOT_AVAILABLE"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_CHECKSUM_FAILED"
  | "UPDATE_INSTALL_FAILED"
  | "UPDATE_RECONNECT_FAILED";
```

Add response types:

```ts
export type NativeHostUpdateStatusResponse =
  | {
      type: "NATIVE_HOST_UPDATE_STATUS_RESULT";
      requestId: string;
      ok: true;
      installedVersion: string;
      latestVersion: string;
      latestTag: string;
      updateAvailable: boolean;
      releaseUrl: string;
    }
  | {
      type: "NATIVE_HOST_UPDATE_STATUS_RESULT";
      requestId: string;
      ok: false;
      error: NativeHostUpdateErrorCode | "INVALID_MESSAGE" | "UNSUPPORTED_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeHostUpdateResponse =
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: true;
      previousVersion: string;
      installedVersion: string;
      installedPath: string;
    }
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: false;
      error: NativeHostUpdateErrorCode | "INVALID_MESSAGE" | "UNSUPPORTED_MESSAGE";
      message: string;
      retryable: boolean;
    };
```

Add both request and response types to the `NativeRequest` and `NativeResponse` unions.

- [ ] **Step 5: Add extension message types**

In `src/shared/messages.ts`, add request variants:

```ts
| {
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS";
    requestId: string;
  }
| {
    type: "CHECK_NATIVE_HOST_UPDATE";
    requestId: string;
  }
| {
    type: "UPDATE_NATIVE_HOST";
    requestId: string;
    targetTag: string;
    targetVersion: string;
  }
```

Add a stored status shape:

```ts
export type NativeHostUpdateStoredStatus =
  | {
      checkedAt: number;
      ok: true;
      installedVersion: string;
      latestVersion: string;
      latestTag: string;
      updateAvailable: boolean;
      releaseUrl: string;
    }
  | {
      checkedAt: number;
      ok: false;
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "UPDATE_UNSUPPORTED_PLATFORM"
        | "UPDATE_CHECK_FAILED"
        | "UPDATE_NOT_AVAILABLE"
        | "UPDATE_DOWNLOAD_FAILED"
        | "UPDATE_CHECKSUM_FAILED"
        | "UPDATE_INSTALL_FAILED"
        | "UPDATE_RECONNECT_FAILED"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      manualUpdateRequired?: boolean;
    };
```

Add response variants:

```ts
export type NativeHostUpdateStatusExtensionResponse = {
  type: "NATIVE_HOST_UPDATE_STATUS";
  requestId: string;
  status?: NativeHostUpdateStoredStatus;
};

export type NativeHostUpdateApplyResponse =
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: true;
      previousVersion: string;
      installedVersion: string;
      installedPath: string;
    }
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: false;
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "UPDATE_UNSUPPORTED_PLATFORM"
        | "UPDATE_CHECK_FAILED"
        | "UPDATE_NOT_AVAILABLE"
        | "UPDATE_DOWNLOAD_FAILED"
        | "UPDATE_CHECKSUM_FAILED"
        | "UPDATE_INSTALL_FAILED"
        | "UPDATE_RECONNECT_FAILED"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };
```

Add the response types to `ExtensionResponse`.

- [ ] **Step 6: Implement background native client update functions**

In `src/background/nativeClient.ts`, import the new native types and add type guards:

```ts
function isNativeHostUpdateStatusResult(
  response: NativeResponse
): response is NativeHostUpdateStatusResponse {
  return response.type === "NATIVE_HOST_UPDATE_STATUS_RESULT";
}

function isNativeHostUpdateResult(
  response: NativeResponse
): response is NativeHostUpdateResponse {
  return response.type === "NATIVE_HOST_UPDATE_RESULT";
}
```

Add `checkNativeHostUpdateStatus`:

```ts
export async function checkNativeHostUpdateStatus(
  requestId: string
): Promise<NativeHostUpdateStoredStatus> {
  const checkedAt = Date.now();
  const request: NativeRequest = {
    type: "NATIVE_HOST_UPDATE_STATUS",
    requestId
  };

  try {
    const response = await sendStatusCheckMessageWithRetry(request);

    if (
      response &&
      isNativeHostUpdateStatusResult(response) &&
      response.requestId === requestId
    ) {
      if (response.ok) {
        return {
          checkedAt,
          ok: true,
          installedVersion: response.installedVersion,
          latestVersion: response.latestVersion,
          latestTag: response.latestTag,
          updateAvailable: response.updateAvailable,
          releaseUrl: response.releaseUrl
        };
      }

      return {
        checkedAt,
        ok: false,
        error:
          response.error === "UNSUPPORTED_MESSAGE"
            ? "NATIVE_HOST_UPDATE_REQUIRED"
            : response.error,
        message:
          response.error === "UNSUPPORTED_MESSAGE"
            ? "One manual native host update is required before in-app updates are available."
            : response.message,
        retryable: response.retryable,
        manualUpdateRequired: response.error === "UNSUPPORTED_MESSAGE"
      };
    }

    return {
      checkedAt,
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: "Native host did not respond.",
      retryable: true
    };
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}
```

Add `updateNativeHost` using `sendNativeHostMessage` with a 130 second timeout and return the native result after validating `requestId`.

- [ ] **Step 7: Implement service worker scheduler and handlers**

In `src/background/service-worker.ts`, add constants:

```ts
const NATIVE_HOST_UPDATE_ALARM = "native-host-update-check";
const NATIVE_HOST_UPDATE_STORAGE_KEY = "hoverTransPortNativeHostUpdate";
const NATIVE_HOST_UPDATE_CHECK_INTERVAL_MINUTES = 24 * 60;
const NATIVE_HOST_UPDATE_STALE_MS = 24 * 60 * 60 * 1000;
```

Import `normalizeNativeHostUpdateAutoCheck` and new client functions.

Add alarm setup:

```ts
async function ensureNativeHostUpdateAlarm() {
  const stored = (await chrome.storage.local.get("hoverTransPort")) as StoredOptions;
  const enabled = normalizeNativeHostUpdateAutoCheck(
    stored.hoverTransPort?.nativeHostUpdateAutoCheck
  );

  if (!enabled) {
    await chrome.alarms.clear(NATIVE_HOST_UPDATE_ALARM);
    return;
  }

  await chrome.alarms.create(NATIVE_HOST_UPDATE_ALARM, {
    periodInMinutes: NATIVE_HOST_UPDATE_CHECK_INTERVAL_MINUTES
  });
}
```

Add status storage:

```ts
async function storeNativeHostUpdateStatus(status: NativeHostUpdateStoredStatus) {
  await chrome.storage.local.set({
    [NATIVE_HOST_UPDATE_STORAGE_KEY]: status
  });
}
```

Add immediate check:

```ts
async function refreshNativeHostUpdateStatus(requestId: string) {
  const status = await checkNativeHostUpdateStatus(requestId);
  await storeNativeHostUpdateStatus(status);
  return status;
}
```

Extend the existing `chrome.runtime.onInstalled` listener so it also calls `ensureNativeHostUpdateAlarm`, and register startup/alarm listeners:

```ts
chrome.runtime.onStartup.addListener(() => {
  void ensureNativeHostUpdateAlarm();
});

// In the existing onInstalled listener, call:
void ensureNativeHostUpdateAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NATIVE_HOST_UPDATE_ALARM) {
    void refreshNativeHostUpdateStatus(`alarm:${Date.now()}`);
  }
});
```

Add message handlers for `GET_STORED_NATIVE_HOST_UPDATE_STATUS`, `CHECK_NATIVE_HOST_UPDATE`, and `UPDATE_NATIVE_HOST`. `UPDATE_NATIVE_HOST` should call `updateNativeHost`, then call `checkNativeHost`, then call `refreshNativeHostUpdateStatus`.

- [ ] **Step 8: Run TypeScript checks**

Run:

```bash
pnpm native-host-update:check
pnpm typecheck
```

Expected: both commands pass.

- [ ] **Step 9: Commit extension protocol and scheduler work**

```bash
git add public/manifest.json src/shared/nativeProtocol.ts src/shared/messages.ts src/shared/options.ts src/background/nativeClient.ts src/background/service-worker.ts scripts/native-host-update-check.mjs package.json
git commit -m "feat: schedule native host update checks"
```

---

## Task 4: Options Update UI

**Files:**

- Modify: `src/options.html`
- Modify: `src/options/main.ts`
- Modify: `src/options/options.css`
- Modify: `scripts/native-host-update-check.mjs`

- [ ] **Step 1: Extend static check for Options controls**

In `scripts/native-host-update-check.mjs`, add:

```js
const optionsHtml = read("src/options.html");
assertIncludes(optionsHtml, 'id="native-host-update-auto-check"', "Options auto-check toggle");
assertIncludes(optionsHtml, 'id="native-host-update-status"', "Options update status");
assertIncludes(optionsHtml, 'id="native-host-update-check"', "Options check update button");
assertIncludes(optionsHtml, 'id="native-host-update-apply"', "Options update apply button");

const optionsMain = read("src/options/main.ts");
assertIncludes(optionsMain, "loadNativeHostUpdateStatus", "Options update status loader");
assertIncludes(optionsMain, "checkNativeHostUpdate", "Options update status checker");
assertIncludes(optionsMain, "applyNativeHostUpdate", "Options update applier");
```

- [ ] **Step 2: Run the check and confirm it fails**

Run:

```bash
pnpm native-host-update:check
```

Expected: FAIL because Options update controls and functions do not exist.

- [ ] **Step 3: Add Options markup**

Inside `src/options.html`, in the Native Host section after `native-host-status`, add:

```html
<label class="setting-row native-host-update-toggle">
  <span>Auto-check native host updates</span>
  <input id="native-host-update-auto-check" type="checkbox" />
</label>
<p id="native-host-update-status" class="native-host-update-status" role="status">
  Update status not checked.
</p>
<div class="button-row native-host-update-actions">
  <button id="native-host-update-check" type="button" class="secondary-button">
    Check for Updates
  </button>
  <button id="native-host-update-apply" type="button" class="secondary-button" disabled>
    Update Native Host
  </button>
</div>
```

- [ ] **Step 4: Add Options CSS**

In `src/options/options.css`, add:

```css
.native-host-update-status {
  margin: 8px 0 0;
  color: #475569;
  font-size: 0.92rem;
  line-height: 1.45;
}

.native-host-update-toggle {
  margin-top: 12px;
}

.native-host-update-actions {
  margin-top: 12px;
}
```

- [ ] **Step 5: Wire Options TypeScript**

In `src/options/main.ts`, query elements:

```ts
const nativeHostUpdateAutoCheckInput =
  document.querySelector<HTMLInputElement>("#native-host-update-auto-check");
const nativeHostUpdateStatus =
  document.querySelector<HTMLParagraphElement>("#native-host-update-status");
const nativeHostUpdateCheckButton =
  document.querySelector<HTMLButtonElement>("#native-host-update-check");
const nativeHostUpdateApplyButton =
  document.querySelector<HTMLButtonElement>("#native-host-update-apply");
```

Add status rendering:

```ts
function setNativeHostUpdateStatus(message: string) {
  if (nativeHostUpdateStatus) {
    nativeHostUpdateStatus.textContent = message;
  }
}

function setNativeHostUpdateApplyEnabled(enabled: boolean) {
  if (nativeHostUpdateApplyButton) {
    nativeHostUpdateApplyButton.disabled = !enabled;
  }
}
```

Add formatting:

```ts
function renderNativeHostUpdateStatus(
  status: Extract<ExtensionResponse, { type: "NATIVE_HOST_UPDATE_STATUS" }>["status"]
) {
  if (!status) {
    setNativeHostUpdateStatus("Update status not checked.");
    setNativeHostUpdateApplyEnabled(false);
    return;
  }

  if (status.ok) {
    if (status.updateAvailable) {
      setNativeHostUpdateStatus(
        `Update available: ${status.installedVersion} -> ${status.latestVersion}.`
      );
      setNativeHostUpdateApplyEnabled(true);
      return;
    }

    setNativeHostUpdateStatus(`Native Host is up to date: ${status.installedVersion}.`);
    setNativeHostUpdateApplyEnabled(false);
    return;
  }

  setNativeHostUpdateStatus(status.message);
  setNativeHostUpdateApplyEnabled(false);
}
```

Add message functions:

```ts
async function loadNativeHostUpdateStatus() {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS",
    requestId: createRequestId()
  });

  if (response?.type === "NATIVE_HOST_UPDATE_STATUS") {
    renderNativeHostUpdateStatus(response.status);
  }
}

async function checkNativeHostUpdate() {
  setNativeHostUpdateStatus("Checking for updates.");
  setNativeHostUpdateApplyEnabled(false);
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
    type: "CHECK_NATIVE_HOST_UPDATE",
    requestId: createRequestId()
  });

  if (response?.type === "NATIVE_HOST_UPDATE_STATUS") {
    renderNativeHostUpdateStatus(response.status);
    return;
  }

  setNativeHostUpdateStatus("Could not check for updates.");
}
```

Add update apply:

```ts
async function applyNativeHostUpdate() {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS",
    requestId: createRequestId()
  });

  const status =
    response?.type === "NATIVE_HOST_UPDATE_STATUS" && response.status?.ok
      ? response.status
      : undefined;

  if (!status?.updateAvailable) {
    setNativeHostUpdateStatus("No native host update is available.");
    setNativeHostUpdateApplyEnabled(false);
    return;
  }

  setNativeHostUpdateStatus("Updating native host.");
  setNativeHostUpdateApplyEnabled(false);
  const updateResponse = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "UPDATE_NATIVE_HOST",
    requestId: createRequestId(),
    targetTag: status.latestTag,
    targetVersion: status.latestVersion
  });

  if (updateResponse?.type === "NATIVE_HOST_UPDATE_RESULT" && updateResponse.ok) {
    setNativeHostUpdateStatus(`Updated native host to ${updateResponse.installedVersion}.`);
    await checkNativeHost();
    await checkNativeHostUpdate();
    return;
  }

  if (updateResponse?.type === "NATIVE_HOST_UPDATE_RESULT") {
    setNativeHostUpdateStatus(updateResponse.message);
    return;
  }

  setNativeHostUpdateStatus("Native host update failed.");
}
```

Wire event listeners and load state:

```ts
nativeHostUpdateCheckButton?.addEventListener("click", () => {
  checkNativeHostUpdate().catch((error: unknown) => {
    setNativeHostUpdateStatus(error instanceof Error ? error.message : "Could not check for updates.");
  });
});

nativeHostUpdateApplyButton?.addEventListener("click", () => {
  applyNativeHostUpdate().catch((error: unknown) => {
    setNativeHostUpdateStatus(error instanceof Error ? error.message : "Native host update failed.");
  });
});
```

Set and save `nativeHostUpdateAutoCheck` in `loadOptions` and `saveOptions` using the normalizer from Task 3.

- [ ] **Step 6: Run UI checks**

Run:

```bash
pnpm native-host-update:check
pnpm typecheck
pnpm build
```

Expected: all commands pass.

- [ ] **Step 7: Commit Options UI work**

```bash
git add src/options.html src/options/main.ts src/options/options.css scripts/native-host-update-check.mjs
git commit -m "feat: add native host update controls"
```

---

## Task 5: Release Metadata Fetching, Docs, And Final Verification

**Files:**

- Modify: `native-helper/src/update.rs`
- Modify: `docs/native-host-install.md`
- Modify: `scripts/open-source-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Replace fixture-only metadata loading with production curl support**

In `native-helper/src/update.rs`, update `load_releases` so the fixture path remains first, then production uses fixed `curl`:

```rust
fn load_releases(env: &BTreeMap<String, String>) -> Result<Vec<ReleaseEntry>, UpdateFailure> {
    if let Some(path) = env.get("HOVER_TRANS_PORT_RELEASES_JSON_PATH") {
        let body = fs::read_to_string(path).map_err(|error| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: error.to_string(),
            retryable: true,
        })?;
        return parse_releases(&body);
    }

    let api_url = env
        .get("HOVER_TRANS_PORT_RELEASES_API_URL")
        .cloned()
        .unwrap_or_else(|| {
            "https://api.github.com/repos/monk-lee/hover-trans-port/releases?per_page=10".to_string()
        });
    let curl = env
        .get("HOVER_TRANS_PORT_CURL_PATH")
        .cloned()
        .unwrap_or_else(|| "/usr/bin/curl".to_string());
    let args = vec![
            "-fsSL".to_string(),
            "-H".to_string(),
            "Accept: application/vnd.github+json".to_string(),
            api_url,
    ];
    let output = crate::process::run_process(crate::process::ProcessRequest {
        executable: PathBuf::from(curl),
        args,
        cwd: None,
        env: env.clone(),
        stdin: String::new(),
        timeout_ms: 10_000,
    })
    .map_err(|error| UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: error.to_string(),
        retryable: true,
    })?;

    parse_releases(&output.stdout)
}

fn parse_releases(body: &str) -> Result<Vec<ReleaseEntry>, UpdateFailure> {
    serde_json::from_str(body).map_err(|error| UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: error.to_string(),
        retryable: true,
    })
}
```

- [ ] **Step 2: Add docs for update flow**

In `docs/native-host-install.md`, add a section after Script Installer:

```markdown
## Updating From Options

Hover Trans Port can check for native host updates in the background and show the result in Options.

The first update-capable native host must be installed manually because older native hosts do not understand update messages. After that one-time update, open Options > Diagnostics > Native Host and use `Check for Updates` or `Update Native Host`.

Updates are user-confirmed. The extension does not silently replace the native helper.
```

- [ ] **Step 3: Extend open-source check**

In `scripts/open-source-check.mjs`, add:

```js
assertIncludes(
  nativeHostInstall,
  "The first update-capable native host must be installed manually",
  "docs/native-host-install.md"
);
assertIncludes(
  nativeHostInstall,
  "The extension does not silently replace the native helper",
  "docs/native-host-install.md"
);
```

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm macos:script-installer:build
```

Expected:

- `pnpm test` passes.
- release asset build produces `build/macos-script-installer/install-macos-native-host.sh`.
- release asset build produces `build/macos-script-installer/hover-trans-port-helper-macos-arm64`.
- release asset build produces `build/macos-script-installer/checksums.txt`.

- [ ] **Step 5: Verify generated checksum asset**

Run:

```bash
shasum -a 256 -c checksums.txt
```

Working directory:

```text
build/macos-script-installer
```

Expected:

```text
hover-trans-port-helper-macos-arm64: OK
```

- [ ] **Step 6: Commit final docs and production metadata work**

```bash
git add native-helper/src/update.rs docs/native-host-install.md scripts/open-source-check.mjs package.json
git commit -m "feat: check native host releases"
```

---

## Final Integration Checklist

- [ ] Run `pnpm test`.
- [ ] Run `pnpm macos:script-installer:build`.
- [ ] Run `shasum -a 256 -c checksums.txt` in `build/macos-script-installer`.
- [ ] Run `git status --short` and confirm only intended files are changed before final commit.
- [ ] Manually install the built native host with `bash build/macos-script-installer/install-macos-native-host.sh install`.
- [ ] Load the built extension from `dist/`.
- [ ] Open Options > Diagnostics > Native Host.
- [ ] Confirm `Check Native Host` reports the installed version.
- [ ] Confirm `Check for Updates` reports up to date against the current latest release, or reports update available when pointed at fixture release metadata.
- [ ] Confirm `Update Native Host` stays disabled when no update is available.
- [ ] Confirm translation still works after the update feature is present.
