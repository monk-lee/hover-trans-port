use hover_trans_port_helper::process::{run_process, ProcessRequest, ProviderError};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

#[test]
fn stdin_reaches_child_process() {
    let output = run_fixture("echo-stdin", vec![], "hello from stdin", 5_000).unwrap();

    assert_eq!(output.stdout, "hello from stdin");
}

#[test]
fn nonzero_exit_maps_to_provider_exit_nonzero() {
    let error = run_fixture("exit-7", vec![], "", 5_000).unwrap_err();

    assert!(matches!(
        error,
        ProviderError::ExitNonzero {
            exit_code: Some(7),
            ..
        }
    ));
    assert_eq!(error.code(), "PROVIDER_EXIT_NONZERO");
}

#[test]
fn nonzero_exit_preserves_stdout_when_stderr_is_empty() {
    let error = run_fixture("stdout-exit-7", vec![], "", 5_000).unwrap_err();

    assert!(error.to_string().contains("stdout failure detail"));
}

#[test]
fn timeout_maps_to_provider_timeout() {
    let error = run_fixture("sleep-long", vec![], "", 100).unwrap_err();

    assert!(matches!(error, ProviderError::Timeout { .. }));
    assert_eq!(error.code(), "PROVIDER_TIMEOUT");
}

#[test]
fn large_stdout_does_not_block_process_completion() {
    let output = run_fixture("large-stdout", vec![], "", 5_000).unwrap();

    assert_eq!(output.stdout.len(), 262_144);
}

#[test]
fn arguments_are_passed_without_shell_interpolation() {
    let output = run_fixture("echo-args", vec!["hello; exit 9".to_string()], "", 5_000).unwrap();

    assert_eq!(output.stdout.trim(), "hello; exit 9");
}

fn run_fixture(
    name: &str,
    args: Vec<String>,
    stdin: &str,
    timeout_ms: u64,
) -> Result<hover_trans_port_helper::process::ProcessOutput, ProviderError> {
    let executable = fixture_path(name);
    make_executable(&executable);

    run_process(ProcessRequest {
        executable,
        args,
        cwd: None,
        env: BTreeMap::new(),
        stdin: stdin.to_string(),
        timeout_ms,
    })
}

fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("bin")
        .join(name)
}

fn make_executable(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}
