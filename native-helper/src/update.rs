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
    let required_assets = supported_release_assets(env)?;

    let releases = load_releases(env)?;

    let latest = releases
        .iter()
        .filter(|release| !release.prerelease && !release.draft)
        .filter(|release| has_required_assets(release, required_assets))
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
            "https://api.github.com/repos/monk-lee/hover-trans-port/releases?per_page=10"
                .to_string()
        });
    let curl = env
        .get("HOVER_TRANS_PORT_CURL_PATH")
        .cloned()
        .unwrap_or_else(|| default_curl_path(env));
    let args = vec![
        "-fsSL".to_string(),
        "-H".to_string(),
        "Accept: application/vnd.github+json".to_string(),
        api_url,
    ];
    let output = run_process(ProcessRequest {
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

fn default_curl_path(env: &BTreeMap<String, String>) -> String {
    if platform_os(env) == "windows" {
        return env_value(env, "SystemRoot")
            .map(|system_root| {
                PathBuf::from(system_root)
                    .join("System32")
                    .join("curl.exe")
                    .to_string_lossy()
                    .into_owned()
            })
            .unwrap_or_else(|| r"C:\Windows\System32\curl.exe".to_string());
    }

    "/usr/bin/curl".to_string()
}

pub fn run_update(
    env: &BTreeMap<String, String>,
    target_tag: &str,
    target_version: &str,
) -> Result<UpdateInstallResult, UpdateFailure> {
    let _ = supported_release_assets(env)?;
    validate_update_target(target_tag, target_version)?;

    let metadata_path = active_metadata_path(env)?;
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
        args: update_args(env, target_tag, target_version),
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

fn required_release_assets(env: &BTreeMap<String, String>) -> Option<(&'static str, &'static str)> {
    match (platform_os(env).as_str(), platform_arch(env).as_str()) {
        ("macos", "arm64") | ("macos", "aarch64") => {
            Some(("install.sh", "hover-trans-port-helper-macos-arm64"))
        }
        ("macos", "x86_64") => Some(("install.sh", "hover-trans-port-helper-macos-x64")),
        ("linux", "arm64") | ("linux", "aarch64") => {
            Some(("install.sh", "hover-trans-port-helper-linux-arm64"))
        }
        ("linux", "x86_64") => Some(("install.sh", "hover-trans-port-helper-linux-x64")),
        ("windows", "arm64") | ("windows", "aarch64") => Some((
            "install-windows-native-host.ps1",
            "hover-trans-port-helper-windows-arm64.exe",
        )),
        ("windows", "x86_64") => Some((
            "install-windows-native-host.ps1",
            "hover-trans-port-helper-windows-x64.exe",
        )),
        _ => None,
    }
}

fn supported_release_assets(
    env: &BTreeMap<String, String>,
) -> Result<(&'static str, &'static str), UpdateFailure> {
    required_release_assets(env).ok_or_else(|| UpdateFailure {
        code: "UPDATE_UNSUPPORTED_PLATFORM",
        message: "Native host updates are not supported for this platform or architecture."
            .to_string(),
        retryable: false,
    })
}

fn has_required_assets(release: &ReleaseEntry, required_assets: (&str, &str)) -> bool {
    let (installer_asset, helper_asset) = required_assets;
    let assets = release
        .assets
        .iter()
        .map(|asset| asset.name.as_str())
        .collect::<BTreeSet<_>>();

    has_required_installer_asset(&assets, installer_asset, helper_asset)
        && assets.contains("checksums.txt")
        && assets.contains(helper_asset)
}

fn has_required_installer_asset(
    assets: &BTreeSet<&str>,
    installer_asset: &str,
    helper_asset: &str,
) -> bool {
    assets.contains(installer_asset)
        || (installer_asset == "install.sh"
            && helper_asset.starts_with("hover-trans-port-helper-macos-")
            && assets.contains("install-macos-native-host.sh"))
        || (installer_asset == "install-windows-native-host.ps1"
            && helper_asset.starts_with("hover-trans-port-helper-windows-")
            && assets.contains("install.ps1"))
}

fn update_args(
    env: &BTreeMap<String, String>,
    target_tag: &str,
    target_version: &str,
) -> Vec<String> {
    if platform_os(env) == "windows" {
        return vec![
            "-Command".to_string(),
            "update".to_string(),
            "-ReleaseTag".to_string(),
            target_tag.to_string(),
            "-HostVersion".to_string(),
            target_version.to_string(),
            "-Json".to_string(),
        ];
    }

    vec![
        "update".to_string(),
        "--release-tag".to_string(),
        target_tag.to_string(),
        "--host-version".to_string(),
        target_version.to_string(),
        "--json".to_string(),
    ]
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

fn active_metadata_path(env: &BTreeMap<String, String>) -> Result<PathBuf, UpdateFailure> {
    let install_root = install_root(env);
    if platform_os(env) != "windows" {
        return Ok(install_root.join("current").join("metadata.json"));
    }

    let current_path = install_root.join("current");
    let current_version = fs::read_to_string(&current_path).map_err(|error| UpdateFailure {
        code: "UPDATE_INSTALL_FAILED",
        message: format!("Native host current version could not be read: {error}"),
        retryable: false,
    })?;
    let current_version = current_version.trim();

    if !is_strict_three_part_version(current_version) {
        return Err(UpdateFailure {
            code: "UPDATE_INSTALL_FAILED",
            message: format!("Native host current version could not be parsed: {current_version}"),
            retryable: false,
        });
    }

    Ok(install_root
        .join("native-hosts")
        .join(current_version)
        .join("metadata.json"))
}

fn install_root(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(path) = env.get("HOVER_TRANS_PORT_INSTALL_ROOT") {
        return PathBuf::from(path);
    }

    match platform_os(env).as_str() {
        "windows" => env_value(env, "LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir(env).join("AppData").join("Local"))
            .join("Hover Trans Port"),
        "linux" => home_dir(env)
            .join(".local")
            .join("share")
            .join("hover-trans-port"),
        _ => home_dir(env)
            .join("Library")
            .join("Application Support")
            .join("Hover Trans Port"),
    }
}

fn home_dir(env: &BTreeMap<String, String>) -> PathBuf {
    env.get("HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn env_value(env: &BTreeMap<String, String>, key: &str) -> Option<String> {
    env.get(key).cloned().or_else(|| {
        env.iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .map(|(_, value)| value.clone())
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    #[test]
    fn check_update_loads_release_metadata_with_curl_when_fixture_path_is_absent() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let curl_path = temp.path().join("curl");
        fs::write(
            &curl_path,
            "#!/bin/sh\ncat <<'JSON'\n[{\"tag_name\":\"v0.2.6\",\"prerelease\":false,\"draft\":false,\"html_url\":\"https://github.com/monk-lee/hover-trans-port/releases/tag/v0.2.6\",\"assets\":[{\"name\":\"install-macos-native-host.sh\"},{\"name\":\"checksums.txt\"},{\"name\":\"hover-trans-port-helper-macos-arm64\"}]}]\nJSON\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&curl_path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&curl_path, permissions).unwrap();

        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_CURL_PATH".to_string(),
            curl_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_API_URL".to_string(),
            "https://example.invalid/releases".to_string(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "arm64".to_string(),
        );
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

        let status = check_update(&env, "0.2.5").unwrap();

        assert_eq!(status.latest_version, "0.2.6");
        assert_eq!(status.latest_tag, "v0.2.6");
        assert!(status.update_available);
    }

    #[test]
    fn check_update_ignores_releases_without_required_assets() {
        let temp = tempdir().unwrap();
        let releases_path = temp.path().join("releases.json");
        fs::write(
            &releases_path,
            r#"[
          {"tag_name":"v9.9.9","prerelease":false,"draft":false,"html_url":"https://example.invalid/bad","assets":[{"name":"install-macos-native-host.sh"}]},
          {"tag_name":"v0.2.6","prerelease":false,"draft":false,"html_url":"https://example.invalid/good","assets":[{"name":"install-macos-native-host.sh"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-macos-arm64"}]}
        ]"#,
        )
        .unwrap();

        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
            releases_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "arm64".to_string(),
        );
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

        let status = check_update(&env, "0.2.5").unwrap();

        assert_eq!(status.latest_version, "0.2.6");
        assert_eq!(status.release_url, "https://example.invalid/good");
    }

    #[test]
    fn check_update_accepts_macos_release_install_sh_asset() {
        let temp = tempdir().unwrap();
        let releases_path = temp.path().join("releases.json");
        fs::write(
            &releases_path,
            r#"[{"tag_name":"v0.2.15","prerelease":false,"draft":false,"html_url":"https://example.invalid/macos","assets":[{"name":"install.sh"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-macos-arm64"}]}]"#,
        )
        .unwrap();
        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
            releases_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "arm64".to_string(),
        );
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

        let status = check_update(&env, "0.2.14").unwrap();

        assert_eq!(status.latest_version, "0.2.15");
        assert!(status.update_available);
    }

    #[test]
    fn check_update_accepts_linux_release_assets() {
        let temp = tempdir().unwrap();
        let releases_path = temp.path().join("releases.json");
        fs::write(
            &releases_path,
            r#"[{"tag_name":"v0.2.15","prerelease":false,"draft":false,"html_url":"https://example.invalid/linux","assets":[{"name":"install.sh"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-linux-x64"}]}]"#,
        )
        .unwrap();
        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
            releases_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "x86_64".to_string(),
        );
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "linux".to_string());

        let status = check_update(&env, "0.2.14").unwrap();

        assert_eq!(status.latest_version, "0.2.15");
        assert!(status.update_available);
    }

    #[test]
    fn check_update_accepts_windows_release_assets() {
        let temp = tempdir().unwrap();
        let releases_path = temp.path().join("releases.json");
        fs::write(
            &releases_path,
            r#"[{"tag_name":"v0.2.15","prerelease":false,"draft":false,"html_url":"https://example.invalid/windows","assets":[{"name":"install-windows-native-host.ps1"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-windows-x64.exe"}]}]"#,
        )
        .unwrap();
        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
            releases_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "x86_64".to_string(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_OS".to_string(),
            "windows".to_string(),
        );

        let status = check_update(&env, "0.2.14").unwrap();

        assert_eq!(status.latest_version, "0.2.15");
        assert!(status.update_available);
    }

    #[test]
    fn check_update_accepts_windows_arm64_release_assets() {
        let temp = tempdir().unwrap();
        let releases_path = temp.path().join("releases.json");
        fs::write(
            &releases_path,
            r#"[{"tag_name":"v0.2.15","prerelease":false,"draft":false,"html_url":"https://example.invalid/windows-arm64","assets":[{"name":"install-windows-native-host.ps1"},{"name":"checksums.txt"},{"name":"hover-trans-port-helper-windows-arm64.exe"}]}]"#,
        )
        .unwrap();
        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
            releases_path.to_string_lossy().into_owned(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "aarch64".to_string(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_OS".to_string(),
            "windows".to_string(),
        );

        let status = check_update(&env, "0.2.14").unwrap();

        assert_eq!(status.latest_version, "0.2.15");
        assert!(status.update_available);
    }

    #[cfg(unix)]
    #[test]
    fn check_update_uses_windows_systemroot_curl_default() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let system_root = temp.path().join("Windows");
        let curl_path = system_root.join("System32").join("curl.exe");
        fs::create_dir_all(curl_path.parent().unwrap()).unwrap();
        fs::write(
            &curl_path,
            "#!/bin/sh\ncat <<'JSON'\n[{\"tag_name\":\"v0.2.15\",\"prerelease\":false,\"draft\":false,\"html_url\":\"https://example.invalid/windows\",\"assets\":[{\"name\":\"install-windows-native-host.ps1\"},{\"name\":\"checksums.txt\"},{\"name\":\"hover-trans-port-helper-windows-x64.exe\"}]}]\nJSON\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&curl_path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&curl_path, permissions).unwrap();

        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_RELEASES_API_URL".to_string(),
            "https://example.invalid/releases".to_string(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "x86_64".to_string(),
        );
        env.insert(
            "HOVER_TRANS_PORT_TEST_OS".to_string(),
            "windows".to_string(),
        );
        env.insert(
            "SystemRoot".to_string(),
            system_root.to_string_lossy().into_owned(),
        );

        let status = check_update(&env, "0.2.14").unwrap();

        assert_eq!(status.latest_version, "0.2.15");
        assert!(status.update_available);
    }

    #[test]
    fn windows_default_install_root_uses_localappdata() {
        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_TEST_OS".to_string(),
            "windows".to_string(),
        );
        env.insert(
            "LOCALAPPDATA".to_string(),
            r"C:\Users\Ada\AppData\Local".to_string(),
        );

        assert_eq!(
            install_root(&env),
            PathBuf::from(r"C:\Users\Ada\AppData\Local").join("Hover Trans Port")
        );
    }

    #[test]
    fn linux_default_install_root_uses_home_local_share() {
        let temp = tempdir().unwrap();
        let mut env = BTreeMap::new();
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "linux".to_string());
        env.insert(
            "HOME".to_string(),
            temp.path().to_string_lossy().into_owned(),
        );

        assert_eq!(
            install_root(&env),
            temp.path()
                .join(".local")
                .join("share")
                .join("hover-trans-port")
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_update_rejects_unsupported_platform_before_invoking_updater() {
        use std::os::unix::fs::symlink;
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let install_root = temp.path().join("Hover Trans Port");
        let current_dir = install_root.join("native-hosts/0.2.3");
        fs::create_dir_all(&current_dir).unwrap();
        symlink(&current_dir, install_root.join("current")).unwrap();

        let marker_path = temp.path().join("updater-invoked");
        let updater_path = current_dir.join("install.sh");
        fs::write(
            &updater_path,
            format!(
                "#!/bin/sh\nprintf invoked > '{}'\nprintf '%s\n' '{{\"ok\":true,\"previousVersion\":\"0.2.3\",\"installedVersion\":\"0.2.4\",\"helperPath\":\"/tmp/helper\"}}'\n",
                marker_path.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&updater_path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&updater_path, permissions).unwrap();

        fs::write(
            install_root.join("current").join("metadata.json"),
            format!(
                "{{\"hostVersion\":\"0.2.3\",\"protocolVersion\":1,\"source\":\"unix-script-installer\",\"updaterPath\":\"{}\"}}",
                updater_path.display()
            ),
        )
        .unwrap();

        let mut env = BTreeMap::new();
        env.insert(
            "HOVER_TRANS_PORT_INSTALL_ROOT".to_string(),
            install_root.to_string_lossy().into_owned(),
        );
        env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "linux".to_string());
        env.insert(
            "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
            "sparc".to_string(),
        );

        let error = run_update(&env, "v0.2.4", "0.2.4").unwrap_err();

        assert_eq!(error.code, "UPDATE_UNSUPPORTED_PLATFORM");
        assert!(!error.retryable);
        assert!(!marker_path.exists());
    }
}
