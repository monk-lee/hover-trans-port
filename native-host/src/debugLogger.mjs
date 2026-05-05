import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_LOG_DIR = join(homedir(), ".hover-trans-port");
const DEFAULT_LOG_FILENAME = "hover-trans-port.log";
const DEFAULT_TAIL_BYTES = 32 * 1024;
const DEFAULT_TAIL_LINES = 200;

export function resolveDebugLogPath() {
  const explicitPath = process.env.HOVER_TRANS_PORT_LOG_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  const logDir = process.env.HOVER_TRANS_PORT_LOG_DIR?.trim() || DEFAULT_LOG_DIR;
  return join(logDir, DEFAULT_LOG_FILENAME);
}

function toTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitizeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
}

function normalizePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

export class FileDebugLogger {
  constructor({ logPath = resolveDebugLogPath(), now = () => new Date() } = {}) {
    this.logPath = logPath;
    this.now = now;
  }

  info() {
    try {
      const stats = statSync(this.logPath);
      return {
        logPath: this.logPath,
        exists: true,
        sizeBytes: stats.size
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return {
          logPath: this.logPath,
          exists: false,
          sizeBytes: 0
        };
      }

      throw error;
    }
  }

  write(event, fields = {}) {
    try {
      mkdirSync(dirname(this.logPath), { recursive: true });
      const entry = {
        timestamp: toTimestamp(this.now()),
        event,
        ...sanitizeFields(fields)
      };
      appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  readTail({ maxBytes = DEFAULT_TAIL_BYTES, maxLines = DEFAULT_TAIL_LINES } = {}) {
    const info = this.info();
    if (!info.exists || info.sizeBytes === 0) {
      return {
        ...info,
        content: "",
        truncated: false
      };
    }

    const byteLimit = normalizePositiveInteger(maxBytes, DEFAULT_TAIL_BYTES);
    const lineLimit = normalizePositiveInteger(maxLines, DEFAULT_TAIL_LINES);
    const bytesToRead = Math.min(byteLimit, info.sizeBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = openSync(this.logPath, "r");

    try {
      readSync(fd, buffer, 0, bytesToRead, info.sizeBytes - bytesToRead);
    } finally {
      closeSync(fd);
    }

    let content = buffer.toString("utf8");
    let truncated = info.sizeBytes > bytesToRead;
    if (truncated) {
      content = content.replace(/^[^\n]*\n?/, "");
    }

    const lines = content.split(/\r?\n/);
    if (lines.length > lineLimit) {
      content = lines.slice(-lineLimit).join("\n");
      truncated = true;
    }

    return {
      ...info,
      content,
      truncated
    };
  }

  clear() {
    mkdirSync(dirname(this.logPath), { recursive: true });
    writeFileSync(this.logPath, "", "utf8");
    return this.info();
  }
}

export function createDebugLogger(options) {
  return new FileDebugLogger(options);
}
