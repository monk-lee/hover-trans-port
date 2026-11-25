import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTranslatePrompt } from "./buildTranslatePrompt.mjs";
import { findCodexBinary } from "./findCodexBinary.mjs";
import { parseCodexOutput } from "./parseCodexOutput.mjs";
import { createFallbackModelCatalog } from "./providerRegistry.mjs";
import { spawnWithTimeout } from "./spawnWithTimeout.mjs";

const DEFAULT_TRANSLATE_TIMEOUT_MS = 30_000;
const DEFAULT_STATUS_TIMEOUT_MS = 5_000;
export const DEFAULT_CODEX_MODEL = createFallbackModelCatalog("codex").defaultModel;
const PREFERRED_CODEX_MODELS = [
  DEFAULT_CODEX_MODEL, "gpt-5.6-luna", "gpt-5.3-codex-spark", "gpt-5.4-mini"
];
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

function extractJsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function createCodexModelCatalog(parsed) {
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
            label: PREFERRED_CODEX_MODELS.includes(value) ? `${label} (medium)` : label
          };
        })
        .filter(
          (model) => model.value && !UNSUPPORTED_CODEX_MODELS.has(model.value)
        )
    : [];

  if (!models.length) {
    return null;
  }

  const preferred = PREFERRED_CODEX_MODELS
    .map((value) => models.find((model) => model.value === value))
    .find(Boolean) ?? models[0];
  preferred.recommended = true;
  return {
    provider: "codex",
    defaultModel: preferred.value,
    models,
    supportsCustomModel: true,
    source: "cli"
  };
}

function parseCodexModelCatalog(stdout) {
  let searchIndex = 0;

  while (searchIndex < stdout.length) {
    const start = stdout.indexOf("{", searchIndex);

    if (start < 0) {
      return null;
    }

    const jsonText = extractJsonObjectAt(stdout, start);
    searchIndex = start + 1;

    if (!jsonText) {
      continue;
    }

    try {
      const catalog = createCodexModelCatalog(JSON.parse(jsonText));
      if (catalog) {
        return catalog;
      }
    } catch {
      // Keep scanning: Codex may print non-JSON status text before the payload.
    }
  }

  return null;
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
    const fallbackCatalog = createFallbackModelCatalog("codex");
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
          ...(PREFERRED_CODEX_MODELS.includes(codexModel) ? ["-c", 'model_reasoning_effort="medium"'] : []),
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
