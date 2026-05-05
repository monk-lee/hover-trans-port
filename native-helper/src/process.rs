use std::collections::BTreeMap;
use std::fmt;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Instant;

use wait_timeout::ChildExt;

#[derive(Debug)]
pub enum ProviderError {
    NotFound {
        executable: PathBuf,
    },
    SpawnFailed {
        message: String,
    },
    ExitNonzero {
        exit_code: Option<i32>,
        stderr: String,
        elapsed_ms: u64,
    },
    Timeout {
        elapsed_ms: u64,
    },
    Output(std::io::Error),
    OutputParseFailed {
        message: String,
    },
}

impl ProviderError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "PROVIDER_NOT_FOUND",
            Self::SpawnFailed { .. } | Self::ExitNonzero { .. } => "PROVIDER_EXIT_NONZERO",
            Self::Timeout { .. } => "PROVIDER_TIMEOUT",
            Self::Output(_) | Self::OutputParseFailed { .. } => "PROVIDER_OUTPUT_PARSE_FAILED",
        }
    }

    pub fn retryable(&self) -> bool {
        !matches!(self, Self::NotFound { .. })
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { executable } => {
                write!(formatter, "{} was not found.", executable.display())
            }
            Self::SpawnFailed { message } => {
                write!(formatter, "Provider process failed to start: {message}")
            }
            Self::ExitNonzero {
                exit_code, stderr, ..
            } => write!(
                formatter,
                "Provider exited with status {:?}: {}",
                exit_code,
                stderr.trim()
            ),
            Self::Timeout { .. } => write!(formatter, "Provider process timed out."),
            Self::Output(error) => write!(formatter, "Provider output could not be read: {error}"),
            Self::OutputParseFailed { message } => {
                write!(formatter, "Provider output could not be parsed: {message}")
            }
        }
    }
}

impl std::error::Error for ProviderError {}

#[derive(Clone, Debug)]
pub struct ProcessRequest {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: BTreeMap<String, String>,
    pub stdin: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
    pub elapsed_ms: u64,
}

pub fn run_process(request: ProcessRequest) -> Result<ProcessOutput, ProviderError> {
    if !request.executable.exists() {
        return Err(ProviderError::NotFound {
            executable: request.executable,
        });
    }

    let started = Instant::now();
    let mut command = Command::new(&request.executable);
    command
        .args(&request.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .envs(&request.env);

    if let Some(cwd) = &request.cwd {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.stdin.as_bytes())
            .map_err(ProviderError::Output)?;
    }

    let timeout = std::time::Duration::from_millis(request.timeout_ms);
    let status = child.wait_timeout(timeout).map_err(ProviderError::Output)?;

    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ProviderError::Timeout {
            elapsed_ms: elapsed_ms(started),
        });
    }

    let output = child.wait_with_output().map_err(ProviderError::Output)?;
    let elapsed_ms = elapsed_ms(started);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(ProviderError::ExitNonzero {
            exit_code: output.status.code(),
            stderr,
            elapsed_ms,
        });
    }

    Ok(ProcessOutput {
        stdout,
        stderr,
        elapsed_ms,
    })
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}
