import type {
  NativeHostUpdateStoredErrorCode,
  NativeHostUpdateStoredStatus
} from "./messages";

export const MANUAL_NATIVE_HOST_UPDATE_COMMAND =
  "curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash";

export const NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS = 60 * 60 * 1000;
export const NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;

type NativeHostUpdateMetadataInput = {
  checkedAt?: number;
  previousStatus?: NativeHostUpdateStoredStatus;
  error?: NativeHostUpdateStoredErrorCode;
};

export type NativeHostUpdateUserMessage = {
  title: string;
  detail: string;
  attention: boolean;
};

export function getNativeHostUpdateNextCheckAt(
  checkedAt: number,
  failureCount: number
): number {
  if (failureCount <= 0) {
    return checkedAt + NATIVE_HOST_UPDATE_NORMAL_CHECK_INTERVAL_MS;
  }

  if (failureCount === 1) {
    return checkedAt + NATIVE_HOST_UPDATE_FIRST_FAILURE_RETRY_MS;
  }

  return checkedAt + NATIVE_HOST_UPDATE_REPEATED_FAILURE_RETRY_MS;
}

export function createNativeHostUpdateMetadata({
  checkedAt = Date.now(),
  previousStatus,
  error
}: NativeHostUpdateMetadataInput = {}) {
  const previousFailureCount =
    previousStatus?.ok === false && Number.isFinite(previousStatus.failureCount)
      ? previousStatus.failureCount
      : 0;

  const failureCount = error ? previousFailureCount + 1 : 0;

  return {
    checkedAt,
    nextCheckAt: getNativeHostUpdateNextCheckAt(checkedAt, failureCount),
    failureCount,
    lastErrorCode: error
  };
}

export function isNativeHostUpdateRefreshDue(
  status: NativeHostUpdateStoredStatus | undefined,
  now = Date.now()
): boolean {
  return !status || now >= status.nextCheckAt;
}

export function nativeHostUpdateNeedsAttention(
  status: NativeHostUpdateStoredStatus | undefined
): status is NativeHostUpdateStoredStatus {
  if (!status) {
    return false;
  }

  if (status.ok) {
    return status.updateAvailable;
  }

  return (
    status.manualUpdateRequired === true ||
    status.error === "NATIVE_HOST_UPDATE_REQUIRED" ||
    status.error === "NATIVE_HOST_UNSUPPORTED"
  );
}

export function formatNativeHostUpdateStatusForUser(
  status: NativeHostUpdateStoredStatus
): NativeHostUpdateUserMessage {
  if (status.ok) {
    if (status.updateAvailable) {
      return {
        title: "Native Host update available",
        detail: `Native Host ${status.installedVersion} -> ${status.latestVersion}. Open Options to update.`,
        attention: true
      };
    }

    return {
      title: "Native Host up to date",
      detail: `Native Host is up to date: ${status.installedVersion}.`,
      attention: false
    };
  }

  if (
    status.manualUpdateRequired === true ||
    status.error === "NATIVE_HOST_UPDATE_REQUIRED"
  ) {
    return {
      title: "Native Host update required",
      detail: `${status.message} Run once, then reload the extension: ${MANUAL_NATIVE_HOST_UPDATE_COMMAND}`,
      attention: true
    };
  }

  if (status.error === "NATIVE_HOST_UNSUPPORTED") {
    return {
      title: "Extension update required",
      detail: status.message,
      attention: true
    };
  }

  if (status.error === "UPDATE_RECONNECT_FAILED") {
    return {
      title: "Native Host update verification needed",
      detail:
        "The update may have installed, but the extension could not reconnect to verify it. Reload the extension or Chrome, then check again.",
      attention: false
    };
  }

  if (status.retryable) {
    return {
      title: "Native Host update check failed",
      detail: `${status.message} You can retry from Options.`,
      attention: false
    };
  }

  return {
    title: "Native Host update status unavailable",
    detail: status.message,
    attention: false
  };
}
