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

    if platform_os(env) == "windows" {
        append_dirs(&mut candidates, &names, windows_env_local_dirs(env));
    }

    if let Some(home) = home_profile(env) {
        append_dirs(
            &mut candidates,
            &names,
            provider_user_local_dirs(binary_name, home),
        );
        append_dirs(&mut candidates, &names, user_local_dirs(env, home));
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
            Path::new(home).join(".local").join("bin"),
            Path::new(home).join("scoop").join("shims"),
        ];
    }

    vec![
        Path::new(home).join(".local").join("bin"),
        Path::new(home).join(".npm-global").join("bin"),
        Path::new(home).join(".bun").join("bin"),
        Path::new(home).join(".cargo").join("bin"),
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

fn home_profile(env: &BTreeMap<String, String>) -> Option<&str> {
    env.get("HOME")
        .or_else(|| env.get("USERPROFILE"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

fn env_path(env: &BTreeMap<String, String>, key: &str) -> Option<PathBuf> {
    env.get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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
