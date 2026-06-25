import type {
  ExtensionRequest,
  ExtensionResponse,
  NativeHostUpdateStoredStatus
} from "../shared/messages";
import {
  formatNativeHostUpdateStatusForUser,
  nativeHostUpdateNeedsAttention
} from "../shared/nativeHostUpdate";
import {
  formatProviderUnavailableMessage,
  getProviderLabel,
  resolveProviderForModel
} from "../shared/providers";
import {
  DEFAULT_EXTENSION_ENABLED,
  normalizeEnabled,
  normalizeProvider,
  type StoredOptions
} from "../shared/options";
import "./popup.css";

const statusTitle = document.querySelector<HTMLHeadingElement>("#status-title");
const statusDetail =
  document.querySelector<HTMLParagraphElement>("#status-detail");
const statusIndicator =
  document.querySelector<HTMLElement>("#status-indicator");
const enabledInput = document.querySelector<HTMLInputElement>("#enabled");
const openOptionsButton =
  document.querySelector<HTMLButtonElement>("#open-options");

type PopupStatusState = "ready" | "warning" | "error" | "muted" | "checking";

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function setStatus(
  title: string,
  detail: string,
  state: PopupStatusState
): void {
  if (statusTitle) {
    statusTitle.textContent = title;
  }

  if (statusDetail) {
    statusDetail.textContent = detail;
  }

  if (statusIndicator) {
    statusIndicator.dataset.state = state;
  }
}

async function getStoredOptions(): Promise<StoredOptions> {
  return (await chrome.storage.local.get("hoverTransPort")) as StoredOptions;
}

async function saveEnabled(enabled: boolean): Promise<void> {
  const options = await getStoredOptions();

  await chrome.storage.local.set({
    hoverTransPort: {
      ...options.hoverTransPort,
      enabled
    }
  });
}

async function openExtensionOptions(): Promise<void> {
  try {
    await chrome.runtime.openOptionsPage();
    return;
  } catch {
    // Some Chromium builds reject the managed options UI even when the page exists.
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL("options.html")
  });
}

async function getNativeHostUpdateStatus(): Promise<
  NativeHostUpdateStoredStatus | undefined
> {
  const requestId = createRequestId();
  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS",
    requestId
  });

  if (
    response?.type === "NATIVE_HOST_UPDATE_STATUS" &&
    response.requestId === requestId
  ) {
    return response.status;
  }

  return undefined;
}

async function checkSelectedProviderStatus(options: StoredOptions): Promise<void> {
  const selectedProvider = normalizeProvider(options.hoverTransPort?.provider);
  const providerId = resolveProviderForModel(selectedProvider);
  const providerLabel = getProviderLabel(providerId);
  const requestId = createRequestId();
  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "CHECK_PROVIDER_STATUS",
    requestId,
    provider: selectedProvider
  });

  if (response?.type !== "PROVIDER_STATUS" || response.requestId !== requestId) {
    setStatus("Status unavailable", "Open Options to check diagnostics.", "error");
    return;
  }

  if (!response.ok) {
    const title =
      response.error === "NATIVE_HOST_UNAVAILABLE"
        ? "Native Host unavailable"
        : "Status unavailable";
    setStatus(title, response.message, "error");
    return;
  }

  const providerStatus = response.providers.find(
    (provider) => provider.id === providerId
  );

  if (!providerStatus?.available) {
    setStatus(
      `${providerLabel} unavailable`,
      formatProviderUnavailableMessage(providerId, providerStatus?.error),
      "warning"
    );
    return;
  }

  setStatus(
    "Ready",
    providerStatus.version
      ? `${providerLabel} ${providerStatus.version}`
      : `${providerLabel} available.`,
    "ready"
  );
}

async function refreshPopup(): Promise<void> {
  const options = await getStoredOptions();
  const enabled = normalizeEnabled(options.hoverTransPort?.enabled);

  if (enabledInput) {
    enabledInput.checked = enabled;
  }

  if (!enabled) {
    setStatus("Disabled", "Extension is turned off.", "muted");
    return;
  }

  const selectedProvider = normalizeProvider(options.hoverTransPort?.provider);
  const providerLabel = getProviderLabel(resolveProviderForModel(selectedProvider));
  setStatus("Checking", `Checking ${providerLabel}...`, "checking");

  const updateStatus = await getNativeHostUpdateStatus();
  if (nativeHostUpdateNeedsAttention(updateStatus)) {
    const message = formatNativeHostUpdateStatusForUser(
      updateStatus,
      navigator.platform
    );
    setStatus(message.title, message.detail, "warning");
    return;
  }

  await checkSelectedProviderStatus(options);
}

enabledInput?.addEventListener("change", () => {
  const enabled = enabledInput.checked ?? DEFAULT_EXTENSION_ENABLED;
  setStatus(enabled ? "Checking" : "Disabled", "Saving...", "checking");

  saveEnabled(enabled)
    .then(refreshPopup)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus("Save failed", message, "error");
    });
});

openOptionsButton?.addEventListener("click", () => {
  openExtensionOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus("Options unavailable", message, "error");
  });
});

refreshPopup().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  setStatus("Status unavailable", message, "error");
});
