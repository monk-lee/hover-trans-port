use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProviderPlatform {
    Unix,
    Windows,
}

impl ProviderPlatform {
    pub(crate) fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    pub(crate) fn from_env_or_current(env: &BTreeMap<String, String>) -> Self {
        if Self::current() == Self::Windows || has_windows_env(env) {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    fn path_separator(self) -> char {
        match self {
            Self::Unix => ':',
            Self::Windows => ';',
        }
    }

    fn default_path_key(self) -> &'static str {
        match self {
            Self::Unix => "PATH",
            Self::Windows => "Path",
        }
    }
}

pub(crate) fn env_value<'a>(env: &'a BTreeMap<String, String>, key: &str) -> Option<&'a String> {
    env.get(key)
        .or_else(|| {
            env.iter()
                .find_map(|(candidate, value)| candidate.eq_ignore_ascii_case(key).then_some(value))
        })
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn find_binary(
    env: &BTreeMap<String, String>,
    override_key: &str,
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    if let Some(path) = env_value(env, override_key) {
        let candidate = PathBuf::from(path);
        return is_executable(&candidate).then_some(candidate);
    }

    candidates
        .into_iter()
        .find(|candidate| is_executable(candidate))
}

pub(crate) fn command_candidates(env: &BTreeMap<String, String>, command: &str) -> Vec<PathBuf> {
    let platform = ProviderPlatform::from_env_or_current(env);
    path_dirs(env, platform)
        .into_iter()
        .flat_map(|dir| command_candidates_in_dir(&dir, command, env, platform))
        .collect()
}

pub(crate) fn command_candidates_in_dir(
    dir: &Path,
    command: &str,
    env: &BTreeMap<String, String>,
    platform: ProviderPlatform,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    push_unique_path(&mut candidates, dir.join(command));

    if platform == ProviderPlatform::Windows && Path::new(command).extension().is_none() {
        for extension in windows_command_extensions(env) {
            push_unique_path(&mut candidates, dir.join(format!("{command}{extension}")));
        }
    }

    candidates
}

pub(crate) fn build_provider_env(
    env: &BTreeMap<String, String>,
    binary: &Path,
    keys: &[&str],
) -> BTreeMap<String, String> {
    let platform = ProviderPlatform::from_env_or_current(env);
    let mut next = BTreeMap::new();

    for key in keys {
        if key.eq_ignore_ascii_case("PATH") {
            continue;
        }

        if let Some((actual_key, value)) = env_entry(env, key) {
            next.insert(actual_key.to_string(), value.clone());
        }
    }

    let path_key = path_env_key(env, platform).to_string();
    let mut path_parts = Vec::new();
    if let Some(value) = path_env_value(env) {
        path_parts.push(value.clone());
    }
    if let Some(parent) = binary.parent() {
        path_parts.push(parent.display().to_string());
    }
    if !path_parts.is_empty() {
        next.insert(
            path_key,
            path_parts.join(&platform.path_separator().to_string()),
        );
    }

    next.entry("LANG".to_string())
        .or_insert_with(|| "en_US.UTF-8".to_string());
    next
}

pub(crate) fn is_executable(path: &Path) -> bool {
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

fn has_windows_env(env: &BTreeMap<String, String>) -> bool {
    env.contains_key("Path")
        || [
            "PATHEXT",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "SystemRoot",
            "ComSpec",
        ]
        .iter()
        .any(|key| env_entry(env, key).is_some())
}

fn env_entry<'a>(env: &'a BTreeMap<String, String>, key: &str) -> Option<(&'a str, &'a String)> {
    env.get_key_value(key)
        .map(|(actual_key, value)| (actual_key.as_str(), value))
        .or_else(|| {
            env.iter().find_map(|(candidate, value)| {
                candidate
                    .eq_ignore_ascii_case(key)
                    .then_some((candidate.as_str(), value))
            })
        })
        .filter(|(_, value)| !value.trim().is_empty())
}

fn path_env_key(env: &BTreeMap<String, String>, platform: ProviderPlatform) -> &str {
    env_entry(env, "PATH")
        .map(|(key, _)| key)
        .unwrap_or_else(|| platform.default_path_key())
}

fn path_env_value(env: &BTreeMap<String, String>) -> Option<&String> {
    env_value(env, "PATH")
}

fn path_dirs(env: &BTreeMap<String, String>, platform: ProviderPlatform) -> Vec<PathBuf> {
    path_env_value(env)
        .into_iter()
        .flat_map(|path| path.split(platform.path_separator()))
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn windows_command_extensions(env: &BTreeMap<String, String>) -> Vec<String> {
    let mut extensions = Vec::new();
    if let Some(pathext) = env_value(env, "PATHEXT") {
        for extension in pathext.split(';') {
            push_unique_extension(&mut extensions, extension);
        }
    }

    for extension in [".exe", ".cmd", ".bat", ".ps1"] {
        push_unique_extension(&mut extensions, extension);
    }

    extensions
}

fn push_unique_extension(extensions: &mut Vec<String>, extension: &str) {
    let trimmed = extension.trim();
    if trimmed.is_empty() {
        return;
    }

    let normalized = if trimmed.starts_with('.') {
        trimmed.to_string()
    } else {
        format!(".{trimmed}")
    };
    for candidate in [normalized.to_ascii_lowercase(), normalized] {
        if !extensions
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            extensions.push(candidate);
        }
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|candidate| candidate == &path) {
        paths.push(path);
    }
}
