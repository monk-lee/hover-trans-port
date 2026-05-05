import { spawn } from "node:child_process";

const OUTPUT_LIMIT_BYTES = 1024 * 1024;

function appendLimited(current, chunk) {
  const next = Buffer.concat([current, chunk]);
  return next.length > OUTPUT_LIMIT_BYTES
    ? next.subarray(next.length - OUTPUT_LIMIT_BYTES)
    : next;
}

export function spawnWithTimeout(
  file,
  args,
  { cwd, env, stdin = "", timeoutMs }
) {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();
    const child = spawn(file, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        elapsedMs: Date.now() - startedAt,
        ...result
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 500).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error:
          error && error.code === "ENOENT"
            ? "PROVIDER_NOT_FOUND"
            : "PROVIDER_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      });
    });

    child.on("close", (exitCode, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          error: "PROVIDER_TIMEOUT",
          message: "Provider process timed out.",
          retryable: true,
          exitCode,
          signal
        });
        return;
      }

      if (exitCode !== 0) {
        finish({
          ok: false,
          error: "PROVIDER_EXIT_NONZERO",
          message: `Provider exited with code ${exitCode}.`,
          retryable: true,
          exitCode,
          signal
        });
        return;
      }

      finish({
        ok: true,
        exitCode,
        signal
      });
    });

    if (stdin) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}
