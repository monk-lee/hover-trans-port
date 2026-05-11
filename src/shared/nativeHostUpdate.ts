import type { NativeHostUpdateStoredStatus } from "./messages";

export const MANUAL_NATIVE_HOST_UPDATE_COMMAND =
  "curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash";

export type NativeHostUpdateUserMessage = {
  title: string;
  detail: string;
  attention: boolean;
};

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

  return {
    title: "Native Host update status unavailable",
    detail: status.message,
    attention: false
  };
}
