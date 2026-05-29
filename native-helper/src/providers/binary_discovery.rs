use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

    if let Some(path) = env.get("PATH") {
        for dir in path
            .split(provider_path_separator(env))
            .filter(|value| !value.is_empty())
        {
            for name in &names {
                candidates.push(Path::new(dir).join(name));
            }
        }
    }

    if let Some(home) = env
        .get("HOME")
        .or_else(|| env.get("USERPROFILE"))
        .filter(|value| !value.trim().is_empty())
    {
        for dir in provider_user_local_dirs(binary_name, home) {
            for name in &names {
                candidates.push(dir.join(name));
            }
        }

        for dir in user_local_dirs(env, home) {
            for name in &names {
                candidates.push(dir.join(name));
            }
        }
    }

    for dir in system_local_dirs(env) {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }

    candidates
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

fn user_local_dirs(env: &BTreeMap<String, String>, home: &str) -> Vec<PathBuf> {
    if platform_os(env) == "windows" {
        return vec![
            env_path(env, "APPDATA").join("npm"),
            env_path(env, "LOCALAPPDATA").join("pnpm"),
            Path::new(home).join(".local").join("bin"),
            Path::new(home).join("scoop").join("shims"),
            env_path(env, "LOCALAPPDATA")
                .join("Microsoft")
                .join("WindowsApps"),
        ];
    }

    vec![
        Path::new(home).join(".local").join("bin"),
        Path::new(home).join(".npm-global").join("bin"),
        Path::new(home).join(".bun").join("bin"),
        Path::new(home).join(".cargo").join("bin"),
    ]
}

fn provider_user_local_dirs(binary_name: &str, home: &str) -> Vec<PathBuf> {
    match binary_name {
        "opencode" => vec![Path::new(home).join(".opencode").join("bin")],
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

fn env_path(env: &BTreeMap<String, String>, key: &str) -> PathBuf {
    env.get(key).map(PathBuf::from).unwrap_or_default()
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
