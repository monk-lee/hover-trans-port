import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTranslatePrompt } from "./buildTranslatePrompt.mjs";
import { findCodexBinary } from "./findCodexBinary.mjs";
import { parseCodexOutput } from "./parseCodexOutput.mjs";
import { spawnWithTimeout } from "./spawnWithTimeout.mjs";

const DEFAULT_TRANSLATE_TIMEOUT_MS = 30_000;
const DEFAULT_STATUS_TIMEOUT_MS = 5_000;
export const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const UNSUPPORTED_CODEX_MODELS = new Set(["gpt-5.4-nano"]);

function createProviderEnv(codexPath) {
  const pathParts = [
    process.env.PATH,
    codexPath ? codexPath.split("/").slice(0, -1).join("/") : ""
  ].filter(Boolean);
  const env = {
    HOME: process.env.HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    PATH: pathParts.join(":"),
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL
  };

  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === "string")
  );
}

function compactVersion(stdout) {
  return stdout.replace(/\s+/g, " ").trim();
}

function normalizeProviderFailure(result) {
  return {
    available: false,
    error: result.error ?? "PROVIDER_UNAVAILABLE"
  };
}

function createCodexFallbackModelCatalog() {
  return {
    provider: "codex",
    defaultModel: DEFAULT_CODEX_MODEL,
    models: [
      { value: "gpt-5.5", label: "GPT-5.5" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: true },
      { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
      { value: "gpt-5.2", label: "GPT-5.2" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  };
}

function parseCodexModelCatalog(stdout) {
  const jsonLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));

  if (!jsonLine) {
    return null;
  }

  const parsed = JSON.parse(jsonLine);
  const models = Array.isArray(parsed.models)
    ? parsed.models
        .filter((model) => model?.visibility === "list")
        .map((model) => {
          const value = typeof model.slug === "string" ? model.slug : "";
          const label =
            typeof model.display_name === "string"
              ? model.display_name
              : value;
          return {
            value,
            label,
            recommended: value === DEFAULT_CODEX_MODEL || undefined
          };
        })
        .filter(
          (model) => model.value && !UNSUPPORTED_CODEX_MODELS.has(model.value)
        )
    : [];

  if (!models.length) {
    return null;
  }

  return {
    provider: "codex",
    defaultModel: DEFAULT_CODEX_MODEL,
    models,
    supportsCustomModel: true,
    source: "cli"
  };
}

function resolveCodexModel(model) {
  const selectedModel =
    process.env.HOVER_TRANS_PORT_CODEX_MODEL?.trim() ||
    model?.trim() ||
    DEFAULT_CODEX_MODEL;

  return UNSUPPORTED_CODEX_MODELS.has(selectedModel)
    ? DEFAULT_CODEX_MODEL
    : selectedModel;
}

export class CodexProvider {
  id = "codex";
  label = "Codex CLI";
  defaultModel = DEFAULT_CODEX_MODEL;

  constructor({
    translateTimeoutMs = DEFAULT_TRANSLATE_TIMEOUT_MS,
    statusTimeoutMs = DEFAULT_STATUS_TIMEOUT_MS
  } = {}) {
    this.translateTimeoutMs = translateTimeoutMs;
    this.statusTimeoutMs = statusTimeoutMs;
  }

  findBinary() {
    return findCodexBinary();
  }

  async isAvailable() {
    const binaryPath = this.findBinary();

    if (!binaryPath) {
      return {
        available: false,
        error: "PROVIDER_NOT_FOUND"
      };
    }

    const version = await spawnWithTimeout(binaryPath, ["--version"], {
      env: createProviderEnv(binaryPath),
      stdin: "",
      timeoutMs: this.statusTimeoutMs
    });

    if (!version.ok) {
      return {
        binaryPath,
        ...normalizeProviderFailure(version)
      };
    }

    const execHelp = await spawnWithTimeout(binaryPath, ["exec", "--help"], {
      env: createProviderEnv(binaryPath),
      stdin: "",
      timeoutMs: this.statusTimeoutMs
    });

    if (!execHelp.ok) {
      return {
        binaryPath,
        version: compactVersion(version.stdout),
        ...normalizeProviderFailure(execHelp)
      };
    }

    return {
      available: true,
      binaryPath,
      version: compactVersion(version.stdout)
    };
  }

  async modelCatalog() {
    const fallbackCatalog = createCodexFallbackModelCatalog();
    const binaryPath = this.findBinary();

    if (!binaryPath) {
      return fallbackCatalog;
    }

    const result = await spawnWithTimeout(binaryPath, ["debug", "models"], {
      env: createProviderEnv(binaryPath),
      stdin: "",
      timeoutMs: this.statusTimeoutMs
    });

    if (!result.ok) {
      return fallbackCatalog;
    }

    return parseCodexModelCatalog(result.stdout) ?? fallbackCatalog;
  }

  async translate({
    text,
    model,
    sourceLang = "auto",
    targetLang = "ko",
    timeoutMs
  }) {
    const binaryPath = this.findBinary();

    if (!binaryPath) {
      const error = new Error("Codex binary was not found.");
      error.code = "PROVIDER_NOT_FOUND";
      error.retryable = true;
      throw error;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-codex-"));
    const outputFile = join(tempDir, "last-message.txt");
    const prompt = buildTranslatePrompt({ text, sourceLang, targetLang });
    const codexModel = resolveCodexModel(model);
    const requestTimeoutMs =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? Math.max(1, Math.round(timeoutMs))
        : this.translateTimeoutMs;

    try {
      const result = await spawnWithTimeout(
        binaryPath,
        [
          "exec",
          "--model",
          codexModel,
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--ignore-rules",
          "--ignore-user-config",
          "--skip-git-repo-check",
          "-C",
          tempDir,
          "--output-last-message",
          outputFile,
          "-"
        ],
        {
          cwd: tempDir,
          env: createProviderEnv(binaryPath),
          stdin: prompt,
          timeoutMs: requestTimeoutMs
        }
      );

      if (!result.ok) {
        const error = new Error(result.stderr || result.message);
        error.code = result.error;
        error.retryable = result.retryable;
        error.elapsedMs = result.elapsedMs;
        throw error;
      }

      const lastMessage = existsSync(outputFile)
        ? readFileSync(outputFile, "utf8")
        : "";
      const translatedText = parseCodexOutput({
        lastMessage,
        stdout: result.stdout
      });

      return {
        translatedText,
        rawOutput: result.stdout,
        elapsedMs: result.elapsedMs
      };
    } catch (error) {
      if (error && error.code) {
        throw error;
      }

      const wrapped = new Error(
        error instanceof Error ? error.message : String(error)
      );
      wrapped.code = "PROVIDER_OUTPUT_PARSE_FAILED";
      wrapped.retryable = true;
      throw wrapped;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
