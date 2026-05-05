import { strict as assert } from "node:assert";
import { handleNativeRequest } from "../native-host/src/localBridge.mjs";

const requestId = "host-info-check";
const response = await handleNativeRequest({
  type: "HOST_INFO",
  requestId
});

assert.equal(response.type, "HOST_INFO_RESULT");
assert.equal(response.requestId, requestId);
assert.equal(response.ok, true);
assert.equal(response.hostVersion, "0.1.0");
assert.equal(response.bridgeVersion, "0.1.0-phase5");
assert.equal(response.protocolVersion, 1);
assert.equal(typeof response.installPath, "string");
assert.match(response.installPath, /native-host$/);

const invalidResponse = await handleNativeRequest({
  type: "HOST_INFO",
  requestId: 42
});

assert.equal(invalidResponse.type, "HOST_INFO_RESULT");
assert.equal(invalidResponse.ok, false);
assert.equal(invalidResponse.error, "INVALID_MESSAGE");
assert.equal(invalidResponse.retryable, false);

console.log("native-host-protocol-check: HOST_INFO metadata is valid.");
