import { useCallback, useMemo, useRef } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import {
  ChatModeSchema,
  getEffectiveDefaultChatMode,
  isChatModeAllowed,
  isDyadProEnabled,
} from "../lib/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { toast } from "sonner";
import { usePersistChatMode } from "./usePersistChatMode";
import { useTranslation } from "react-i18next";
import {
  getChatModeLabelKey,
  getLocalAgentUnavailableReasonKey,
} from "@/lib/chatModeUtils";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useCurrentChatIdFromRoute } from "./useCurrentChatIdFromRoute";

export function useChatModeToggle() {
  const { t } = useTranslation("chat");
  const { settings, updateSettings, envVars } = useSettings();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const { persistChatMode } = usePersistChatMode();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const getCurrentChatId = useCurrentChatIdFromRoute();

  const isMac = useIsMac();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
    }),
    [isMac],
  );

  const toggleInFlightRef = useRef(false);

  // Single ref holding all values needed inside the stable toggle callback
  const latest = {
    settings,
    envVars,
    isQuotaLoading,
    isQuotaExceeded,
    selectedAppId,
    updateSettings,
    getCurrentChatId,
    queryClient,
    persistChatMode,
    posthog,
    t,
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const toggleChatMode = useCallback(async () => {
    if (toggleInFlightRef.current) {
      toast.info(
        latestRef.current.t("chatMode.switchInProgress", {
          defaultValue: "Mode switch already in progress",
        }),
      );
      return;
    }

    toggleInFlightRef.current = true;

    let loadingToastId: string | number | undefined;
    let loadingToastTimerId: number | undefined;
    try {
      const {
        settings,
        envVars,
        isQuotaLoading,
        isQuotaExceeded,
        selectedAppId,
        updateSettings,
        getCurrentChatId,
        queryClient,
        persistChatMode,
        posthog,
        t,
      } = latestRef.current;

      if (!settings) return;
      const currentMode =
        settings.selectedChatMode ??
        getEffectiveDefaultChatMode(settings, envVars, !isQuotaExceeded);

      const isProEnabled = isDyadProEnabled(settings);
      const freeAgentQuotaAvailable =
        isProEnabled || (!isQuotaLoading && !isQuotaExceeded);
      const allModes = ChatModeSchema.options;
      const availableModes = allModes.filter((mode) =>
        isChatModeAllowed(mode, settings, envVars, freeAgentQuotaAvailable),
      );
      if (availableModes.length === 0) {
        toast.error(
          t("chatMode.noneAvailable", {
            defaultValue: "No chat modes are currently available",
          }),
        );
        return;
      }

      const currentIndex = availableModes.indexOf(currentMode);
      // When current mode is filtered out (e.g., quota exceeded), start from the first mode
      // not from the next one to avoid skipping availableModes[0]
      const newMode =
        currentIndex >= 0
          ? availableModes[(currentIndex + 1) % availableModes.length]
          : availableModes[0];

      const modeLabels = {
        build: t(getChatModeLabelKey("build"), { defaultValue: "Build" }),
        ask: t(getChatModeLabelKey("ask"), { defaultValue: "Ask" }),
        "local-agent": t(getChatModeLabelKey("local-agent", { isProEnabled }), {
          defaultValue: isProEnabled ? "Agent" : "Basic Agent",
        }),
        plan: t(getChatModeLabelKey("plan"), { defaultValue: "Plan" }),
      };

      const localAgentUnavailableReason =
        currentMode === "local-agent" &&
        currentIndex === -1 &&
        !isChatModeAllowed(
          "local-agent",
          settings,
          envVars,
          freeAgentQuotaAvailable,
        )
          ? t(getLocalAgentUnavailableReasonKey(!freeAgentQuotaAvailable), {
              defaultValue: !freeAgentQuotaAvailable
                ? "Agent mode unavailable — free quota exceeded"
                : "Agent mode requires an OpenAI or Anthropic provider",
            })
          : null;

      const localAgentMessage = localAgentUnavailableReason
        ? newMode !== "local-agent"
          ? t("chatMode.agentFallbackSwitched", {
              defaultValue: "Agent mode unavailable — switched to {{mode}}",
              mode: modeLabels[newMode],
            })
          : localAgentUnavailableReason
        : null;

      if (localAgentUnavailableReason && newMode !== "local-agent") {
        toast.info(localAgentMessage!);
      } else if (localAgentMessage) {
        toast.error(localAgentMessage);
        return;
      }

      const chatId = getCurrentChatId();

      loadingToastTimerId = window.setTimeout(() => {
        loadingToastId = toast.loading(
          t("chatMode.switching", {
            defaultValue: "Switching chat mode...",
          }),
        );
      }, 400);

      if (chatId && !selectedAppId) {
        toast.error(
          t("chatMode.noAppSelected", {
            defaultValue: "No app selected — can't change chat mode",
          }),
        );
        return;
      }

      if (chatId && selectedAppId) {
        const result = await persistChatMode({
          chatId,
          appId: selectedAppId,
          chatMode: newMode,
          optimistic: true,
          onPersistSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
          onPersistError: () => {
            toast.error(
              t("chatMode.persistFailed", {
                defaultValue: "Failed to save chat mode to database",
              }),
            );
          },
        });

        if (!result.success) {
          return;
        }
        if (!result.sameRoute) {
          return;
        }
      } else {
        await updateSettings({ selectedChatMode: newMode });
      }

      posthog.capture("chat:mode_toggle", {
        from: currentMode,
        to: newMode,
        trigger: "keyboard_shortcut",
      });
    } finally {
      if (loadingToastTimerId !== undefined) {
        window.clearTimeout(loadingToastTimerId);
      }
      if (loadingToastId !== undefined) {
        toast.dismiss(loadingToastId);
      }
      toggleInFlightRef.current = false;
    }
  }, []);

  useShortcut(
    ".",
    modifiers,
    toggleChatMode,
    true, // Always enabled since we're not dependent on component selector
  );

  return { toggleChatMode, isMac };
}

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUserAgentData;
  if ("userAgentData" in nav && nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function useIsMac(): boolean {
  return useMemo(() => detectIsMac(), []);
}
