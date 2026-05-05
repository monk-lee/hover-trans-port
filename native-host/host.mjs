#!/usr/bin/env node

import { handleNativeRequest } from "./src/localBridge.mjs";

let inputBuffer = Buffer.alloc(0);

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function handleParsedMessage(message) {
  try {
    writeMessage(await handleNativeRequest(message));
  } catch (error) {
    process.stderr.write(`native-host: ${normalizeError(error)}\n`);
    writeMessage({
      type: "ERROR",
      requestId: message?.requestId,
      ok: false,
      error: "INVALID_MESSAGE",
      message: "Native host failed to handle message.",
      retryable: true
    });
  }
}

function processInputBuffer() {
  while (inputBuffer.length >= 4) {
    const messageLength = inputBuffer.readUInt32LE(0);

    if (inputBuffer.length < messageLength + 4) {
      return;
    }

    const payload = inputBuffer.subarray(4, messageLength + 4);
    inputBuffer = inputBuffer.subarray(messageLength + 4);

    try {
      const message = JSON.parse(payload.toString("utf8"));
      void handleParsedMessage(message);
    } catch (error) {
      process.stderr.write(`native-host: ${normalizeError(error)}\n`);
      writeMessage({
        type: "ERROR",
        ok: false,
        error: "INVALID_MESSAGE",
        message: "Native message payload is not valid JSON.",
        retryable: false
      });
    }
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInputBuffer();
});

process.stdin.on("error", (error) => {
  process.stderr.write(`native-host stdin: ${normalizeError(error)}\n`);
});
