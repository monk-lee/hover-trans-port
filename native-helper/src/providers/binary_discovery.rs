use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const WINDOWS_PROVIDER_ENV_KEYS: &[&str] = &[
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
];

pub fn find_provider_binary(
    env: &BTreeMap<String, String>,
    override_key: &str,
    binary_name: &str,
) -> Option<PathBuf> {
    if let Some(path) = env
        .get(override_key)
        .filter(|value| !value.trim().is_empty())
    {
        let candidate = PathBuf::from(path);
        return is_executable(&candidate).then_some(candidate);
    }

    candidate_paths(env, binary_name)
        .into_iter()
        .find(|candidate| is_executable(candidate))
}

pub fn provider_launch_env(
    env: &BTreeMap<String, String>,
    binary: &Path,
    preserved_keys: &[&str],
) -> BTreeMap<String, String> {
    let mut next = BTreeMap::new();
    copy_env_keys(&mut next, env, preserved_keys);

    if platform_os(env) == "windows" {
        copy_env_keys(&mut next, env, WINDOWS_PROVIDER_ENV_KEYS);
    }

    let mut path_parts = Vec::new();
    if let Some(path) = env_value(env, "PATH").filter(|value| !value.is_empty()) {
        path_parts.push(path.to_string());
    }
    if let Some(parent) = binary.parent() {
        path_parts.push(parent.display().to_string());
    }
    if !path_parts.is_empty() {
        next.insert(
            "PATH".to_string(),
            path_parts.join(&provider_path_separator(env).to_string()),
        );
    }

    next
}

pub fn provider_path_separator(env: &BTreeMap<String, String>) -> char {
    if platform_os(env) == "windows" {
        ';'
    } else {
        ':'
    }
}

fn candidate_paths(env: &BTreeMap<String, String>, binary_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let names = binary_names(env, binary_name);

    if let Some(path) = env_value(env, "PATH") {
        for dir in path
            .split(provider_path_separator(env))
            .filter(|value| !value.is_empty())
        {
            for name in &names {
                candidates.push(Path::new(dir).join(name));
            }
        }
    }

    if platform_os(env) == "windows" {
        append_dirs(&mut candidates, &names, windows_env_local_dirs(env));
    }

    if let Some(home) = home_profile(env) {
        append_dirs(
            &mut candidates,
            &names,
            provider_user_local_dirs(binary_name, &home),
        );
        append_dirs(&mut candidates, &names, user_local_dirs(env, &home));
    }

    append_dirs(&mut candidates, &names, system_local_dirs(env));

    candidates
}

fn append_dirs(candidates: &mut Vec<PathBuf>, names: &[String], dirs: Vec<PathBuf>) {
    for dir in dirs {
        for name in names {
            candidates.push(dir.join(name));
        }
    }
}

fn copy_env_keys(
    next: &mut BTreeMap<String, String>,
    env: &BTreeMap<String, String>,
    keys: &[&str],
) {
    for key in keys.iter().filter(|key| **key != "PATH") {
        if let Some(value) = env_value(env, *key).filter(|value| !value.is_empty()) {
            next.insert((*key).to_string(), value.to_string());
        }
    }
}

fn binary_names(env: &BTreeMap<String, String>, binary_name: &str) -> Vec<String> {
    if platform_os(env) == "windows" {
        return vec![
            format!("{binary_name}.cmd"),
            format!("{binary_name}.exe"),
            binary_name.to_string(),
        ];
    }

    vec![binary_name.to_string()]
}

fn user_local_dirs(env: &BTreeMap<String, String>, home: &Path) -> Vec<PathBuf> {
    if platform_os(env) == "windows" {
        return vec![
            home.join(".local").join("bin"),
            home.join("scoop").join("shims"),
        ];
    }

    vec![
        home.join(".local").join("bin"),
        home.join(".npm-global").join("bin"),
        home.join(".bun").join("bin"),
        home.join(".cargo").join("bin"),
    ]
}

fn windows_env_local_dirs(env: &BTreeMap<String, String>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(appdata) = env_path(env, "APPDATA") {
        dirs.push(appdata.join("npm"));
    }

    if let Some(local_appdata) = env_path(env, "LOCALAPPDATA") {
        dirs.push(local_appdata.join("pnpm"));
        dirs.push(local_appdata.join("Microsoft").join("WindowsApps"));
    }

    dirs
}

fn provider_user_local_dirs(binary_name: &str, home: &Path) -> Vec<PathBuf> {
    match binary_name {
        "opencode" => vec![home.join(".opencode").join("bin")],
        _ => Vec::new(),
    }
}

fn system_local_dirs(env: &BTreeMap<String, String>) -> Vec<PathBuf> {
    if platform_os(env) == "windows" {
        return Vec::new();
    }

    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]
}

fn home_profile(env: &BTreeMap<String, String>) -> Option<PathBuf> {
    ["HOME", "USERPROFILE"]
        .into_iter()
        .find_map(|key| env_path(env, key))
}

fn env_path(env: &BTreeMap<String, String>, key: &str) -> Option<PathBuf> {
    env_value(env, key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn env_value<'a>(env: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    if platform_os(env) == "windows" {
        return env_value_ignore_ascii_case(env, key);
    }

    env.get(key).map(String::as_str)
}

fn env_value_ignore_ascii_case<'a>(
    env: &'a BTreeMap<String, String>,
    key: &str,
) -> Option<&'a str> {
    env.get(key).map(String::as_str).or_else(|| {
        env.iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .map(|(_, value)| value.as_str())
    })
}

fn platform_os(env: &BTreeMap<String, String>) -> String {
    env.get("HOVER_TRANS_PORT_TEST_OS")
        .cloned()
        .unwrap_or_else(|| std::env::consts::OS.to_string())
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|metadata| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    metadata.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    !metadata.permissions().readonly()
                }
            })
            .unwrap_or(false)
}
