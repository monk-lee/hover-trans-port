export class CodexOutputParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexOutputParseError";
    this.code = "PROVIDER_OUTPUT_PARSE_FAILED";
  }
}

function stripMarkdownFence(text) {
  const fenceMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1].trim() : text;
}

function extractTextFromJsonObject(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if (typeof value.content === "string") {
    return value.content;
  }

  if (Array.isArray(value.content)) {
    return value.content.map(extractTextFromJsonObject).filter(Boolean).join("");
  }

  if (value.message) {
    return extractTextFromJsonObject(value.message);
  }

  if (value.item) {
    return extractTextFromJsonObject(value.item);
  }

  return "";
}

function extractJsonlText(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let latestText = "";

  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const text = extractTextFromJsonObject(parsed).trim();
      if (text) {
        latestText = text;
      }
    } catch {
      continue;
    }
  }

  return latestText;
}

export function parseCodexOutput({ lastMessage = "", stdout = "" }) {
  const candidate =
    lastMessage.trim() || extractJsonlText(stdout).trim() || stdout.trim();
  const parsed = stripMarkdownFence(candidate.replace(/\r\n/g, "\n").trim());

  if (!parsed) {
    throw new CodexOutputParseError("Codex output was empty.");
  }

  if (/^Translate the following text to Korean\./i.test(parsed)) {
    throw new CodexOutputParseError("Codex output echoed the prompt.");
  }

  return parsed;
}
