export const REQUIRED_NATIVE_HOST_PROTOCOL_VERSION = 1;
export const MAX_SUPPORTED_NATIVE_HOST_PROTOCOL_VERSION = 1;

export type NativeHostInfoLike = {
  hostVersion?: unknown;
  bridgeVersion?: unknown;
  protocolVersion?: unknown;
  appVersion?: unknown;
  installPath?: unknown;
};

export type NativeHostCompatibility =
  | {
      ok: true;
      status: "ready";
      message: string;
    }
  | {
      ok: false;
      status: "updateRequired" | "unsupportedNewer" | "invalidHostInfo";
      message: string;
    };

function isObject(value: unknown): value is NativeHostInfoLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function evaluateNativeHostCompatibility(
  value: unknown
): NativeHostCompatibility {
  if (
    !isObject(value) ||
    typeof value.hostVersion !== "string" ||
    typeof value.bridgeVersion !== "string" ||
    typeof value.protocolVersion !== "number"
  ) {
    return {
      ok: false,
      status: "invalidHostInfo",
      message: "Native Host returned invalid version information."
    };
  }

  if (value.protocolVersion < REQUIRED_NATIVE_HOST_PROTOCOL_VERSION) {
    return {
      ok: false,
      status: "updateRequired",
      message: `Native Host update required. Installed protocol ${value.protocolVersion}, required protocol ${REQUIRED_NATIVE_HOST_PROTOCOL_VERSION}.`
    };
  }

  if (value.protocolVersion > MAX_SUPPORTED_NATIVE_HOST_PROTOCOL_VERSION) {
    return {
      ok: false,
      status: "unsupportedNewer",
      message: `Native Host is newer than this extension supports. Installed protocol ${value.protocolVersion}, maximum supported protocol ${MAX_SUPPORTED_NATIVE_HOST_PROTOCOL_VERSION}.`
    };
  }

  return {
    ok: true,
    status: "ready",
    message: "Native Host is compatible."
  };
}
