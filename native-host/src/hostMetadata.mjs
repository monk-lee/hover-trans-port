import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NATIVE_HOST_VERSION = "0.1.0";
export const NATIVE_BRIDGE_VERSION = "0.1.0-phase5";
export const NATIVE_HOST_PROTOCOL_VERSION = 1;

export function getNativeHostInstallPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function createNativeHostInfo() {
  return {
    hostVersion: NATIVE_HOST_VERSION,
    bridgeVersion: NATIVE_BRIDGE_VERSION,
    protocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
    installPath: getNativeHostInstallPath()
  };
}
