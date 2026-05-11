use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

use crate::process::{run_process, ProcessRequest, ProviderError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpdateStatus {
    pub installed_version: String,
    pub latest_version: String,
    pub latest_tag: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpdateInstallResult {
    pub previous_version: String,
    pub installed_version: String,
    pub installed_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpdateFailure {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Deserialize)]
struct ReleaseEntry {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    html_url: String,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMetadata {
    updater_path: Option<String>,
}

pub fn check_update(
    env: &BTreeMap<String, String>,
    installed_version: &str,
) -> Result<UpdateStatus, UpdateFailure> {
    if platform_os(env) != "macos" {
        return Err(UpdateFailure {
            code: "UPDATE_UNSUPPORTED_PLATFORM",
            message: "Native host updates are only supported on macOS.".to_string(),
            retryable: false,
        });
    }

    let releases_path = env
        .get("HOVER_TRANS_PORT_RELEASES_JSON_PATH")
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: "Release metadata source was not configured.".to_string(),
            retryable: true,
        })?;

    let releases = fs::read_to_string(releases_path).map_err(|error| UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: format!("Release metadata could not be read: {error}"),
        retryable: true,
    })?;
    let releases: Vec<ReleaseEntry> =
        serde_json::from_str(&releases).map_err(|error| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: format!("Release metadata could not be parsed: {error}"),
            retryable: true,
        })?;

    let required_helper_asset = required_helper_asset(env).ok_or_else(|| UpdateFailure {
        code: "UPDATE_UNSUPPORTED_PLATFORM",
        message: "Native host updates are not supported for this architecture.".to_string(),
        retryable: false,
    })?;

    let latest = releases
        .iter()
        .filter(|release| !release.prerelease && !release.draft)
        .filter(|release| has_required_assets(release, required_helper_asset))
        .filter_map(|release| Some((parse_version(&release.tag_name)?, release)))
        .max_by_key(|(version, _)| *version)
        .map(|(_, release)| release)
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_CHECK_FAILED",
            message: "No compatible release was found.".to_string(),
            retryable: true,
        })?;

    let installed_key = parse_version(installed_version).ok_or_else(|| UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: format!("Installed version could not be parsed: {installed_version}"),
        retryable: false,
    })?;
    let latest_key = parse_version(&latest.tag_name).ok_or_else(|| UpdateFailure {
        code: "UPDATE_CHECK_FAILED",
        message: format!("Release version could not be parsed: {}", latest.tag_name),
        retryable: true,
    })?;
    let latest_version = latest.tag_name.trim_start_matches('v').to_string();

    Ok(UpdateStatus {
        installed_version: installed_version.to_string(),
        latest_version,
        latest_tag: latest.tag_name.clone(),
        update_available: latest_key > installed_key,
        release_url: latest.html_url.clone(),
    })
}

pub fn run_update(
    env: &BTreeMap<String, String>,
    target_tag: &str,
    target_version: &str,
) -> Result<UpdateInstallResult, UpdateFailure> {
    validate_update_target(target_tag, target_version)?;

    let metadata_path = active_metadata_path(env);
    let metadata = fs::read_to_string(&metadata_path).map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: format!("Native host metadata could not be read: {error}"),
        retryable: false,
    })?;
    let metadata: InstallMetadata =
        serde_json::from_str(&metadata).map_err(|error| UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: format!("Native host metadata could not be parsed: {error}"),
            retryable: false,
        })?;
    let updater_path = metadata.updater_path.ok_or_else(|| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: "Native host metadata did not include updaterPath.".to_string(),
        retryable: false,
    })?;

    let output = run_process(ProcessRequest {
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
    .map_err(process_update_failure)?;

    let value: Value =
        serde_json::from_str(output.stdout.trim()).map_err(|error| UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: format!("Native host update output could not be parsed: {error}"),
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

    let previous_version = required_string_field(&value, "previousVersion")?;
    let installed_version = required_string_field(&value, "installedVersion")?;
    let installed_path = required_string_field(&value, "helperPath")?;

    Ok(UpdateInstallResult {
        previous_version,
        installed_version,
        installed_path,
    })
}

fn platform_os(env: &BTreeMap<String, String>) -> String {
    env.get("HOVER_TRANS_PORT_TEST_OS")
        .cloned()
        .unwrap_or_else(|| std::env::consts::OS.to_string())
}

fn platform_arch(env: &BTreeMap<String, String>) -> String {
    env.get("HOVER_TRANS_PORT_TEST_ARCH")
        .cloned()
        .unwrap_or_else(|| std::env::consts::ARCH.to_string())
}

fn required_helper_asset(env: &BTreeMap<String, String>) -> Option<&'static str> {
    match platform_arch(env).as_str() {
        "arm64" | "aarch64" => Some("hover-trans-port-helper-macos-arm64"),
        "x86_64" => Some("hover-trans-port-helper-macos-x64"),
        _ => None,
    }
}

fn has_required_assets(release: &ReleaseEntry, helper_asset: &str) -> bool {
    let assets = release
        .assets
        .iter()
        .map(|asset| asset.name.as_str())
        .collect::<BTreeSet<_>>();

    assets.contains("install-macos-native-host.sh")
        && assets.contains("checksums.txt")
        && assets.contains(helper_asset)
}

fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let version = version.trim_start_matches('v');
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;

    if parts.next().is_some() {
        return None;
    }

    Some((major, minor, patch))
}

fn validate_update_target(target_tag: &str, target_version: &str) -> Result<(), UpdateFailure> {
    if !is_strict_three_part_version(target_version) || target_tag != format!("v{target_version}") {
        return Err(UpdateFailure {
            code: "INVALID_MESSAGE",
            message:
                "NATIVE_HOST_UPDATE targetVersion must be x.y.z and targetTag must match v{targetVersion}."
                    .to_string(),
            retryable: false,
        });
    }

    Ok(())
}

fn is_strict_three_part_version(version: &str) -> bool {
    let mut parts = version.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };

    parts.next().is_none()
        && is_numeric_version_part(major)
        && is_numeric_version_part(minor)
        && is_numeric_version_part(patch)
}

fn is_numeric_version_part(part: &str) -> bool {
    !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
}

fn active_metadata_path(env: &BTreeMap<String, String>) -> PathBuf {
    install_root(env).join("current").join("metadata.json")
}

fn install_root(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(path) = env.get("HOVER_TRANS_PORT_INSTALL_ROOT") {
        return PathBuf::from(path);
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library")
        .join("Application Support")
        .join("Hover Trans Port")
}

fn process_update_failure(error: ProviderError) -> UpdateFailure {
    UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

fn required_string_field(value: &Value, field: &'static str) -> Result<String, UpdateFailure> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: format!("Native host update output did not include {field}."),
            retryable: true,
        })
}
