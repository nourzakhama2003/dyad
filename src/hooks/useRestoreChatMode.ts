import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  isChatModeAllowed,
  isDyadProEnabled,
  type ChatSummary,
  type UserSettings,
} from "@/lib/schemas";
import {
  getChatModeLabelKey,
  resolveAllowedChatMode,
} from "@/lib/chatModeUtils";
import { usePersistChatMode } from "./usePersistChatMode";

type UseRestoreChatModeOptions = {
  chatId?: number;
  appId?: number | null;
  settings: UserSettings | null | undefined;
  envVars: Record<string, string | undefined>;
  isQuotaExceeded: boolean;
  updateSettings: (
    settings: Partial<UserSettings>,
  ) => Promise<UserSettings | undefined>;
};

export function useRestoreChatMode({
  chatId,
  appId,
  settings,
  envVars,
  isQuotaExceeded,
  updateSettings,
}: UseRestoreChatModeOptions) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const { persistChatMode } = usePersistChatMode();
  const [isRestoringMode, setIsRestoringMode] = useState(false);

  // Use a ref to track the last chat restored to avoid duplicate restores
  const lastRestoredChatIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!chatId || !settings) {
      return;
    }

    // If we've already restored this chat, skip.
    if (lastRestoredChatIdRef.current === chatId) {
      return;
    }

    let isCancelled = false;
    const restoreAbortController = new AbortController();
    let bannerTimeoutId: number | undefined;

    const setBannerVisible = () => {
      if (!isCancelled) setIsRestoringMode(true);
    };

    // Snapshot values to avoid race conditions
    const snapshottedSettings = { ...settings };
    const snapshottedEnvVars = { ...envVars };
    const snapshottedIsQuotaExceeded = isQuotaExceeded;

    const restoreTimeout = window.setTimeout(() => {
      if (!isCancelled && !restoreAbortController.signal.aborted) {
        restoreAbortController.abort();
        const isProEnabled = isDyadProEnabled(snapshottedSettings);
        const modeLabel = t(
          getChatModeLabelKey(snapshottedSettings.selectedChatMode ?? "build", {
            isProEnabled,
          }),
          { defaultValue: "Build" },
        );
        console.warn(
          `Chat mode restore timed out for chat ${chatId}; showing input anyway.`,
        );
        toast.warning(
          t("chatMode.restoreModeTimedOut", {
            defaultValue:
              "Couldn't restore this chat's mode in time - using {{mode}}.",
            mode: modeLabel,
          }),
          { id: `restore-timeout-${chatId}` },
        );
        setIsRestoringMode(false);
      }
    }, 3_000);

    const clearRestoreTimeout = () => {
      window.clearTimeout(restoreTimeout);
      if (bannerTimeoutId !== undefined) {
        window.clearTimeout(bannerTimeoutId);
      }
    };

    const applyResolvedMode = async (
      candidateMode: ChatSummary["chatMode"],
    ) => {
      if (restoreAbortController.signal.aborted || isCancelled) {
        return;
      }

      if (
        candidateMode === null ||
        candidateMode === undefined ||
        !snapshottedSettings
      ) {
        if (!isCancelled) {
          lastRestoredChatIdRef.current = chatId;
          clearRestoreTimeout();
          setIsRestoringMode(false);
        }
        return;
      }

      // Validate fallbackMode before passing to resolveAllowedChatMode
      let fallbackMode = snapshottedSettings.selectedChatMode ?? "build";
      if (
        !isChatModeAllowed(
          fallbackMode,
          snapshottedSettings,
          snapshottedEnvVars,
          !snapshottedIsQuotaExceeded,
        )
      ) {
        fallbackMode = "build";
      }

      const resolvedMode = resolveAllowedChatMode({
        desiredMode: candidateMode,
        fallbackMode,
        settings: snapshottedSettings,
        envVars: snapshottedEnvVars,
        freeAgentQuotaAvailable: !snapshottedIsQuotaExceeded,
      });

      if (!isCancelled) {
        clearRestoreTimeout();
        lastRestoredChatIdRef.current = chatId;
        if (!resolvedMode.usedFallback) {
          setIsRestoringMode(false);
        }
      }

      let shouldUpdateSelectedChatMode = false;
      if (resolvedMode.usedFallback) {
        toast.info(
          t("chatMode.modeUnavailableFallback", {
            defaultValue:
              "{{mode}} mode unavailable — switched this chat to {{fallbackMode}}",
            mode: t(
              getChatModeLabelKey(candidateMode, {
                isProEnabled: isDyadProEnabled(snapshottedSettings),
              }),
              { defaultValue: "Build" },
            ),
            fallbackMode: t(
              getChatModeLabelKey(resolvedMode.mode, {
                isProEnabled: isDyadProEnabled(snapshottedSettings),
              }),
              { defaultValue: "Build" },
            ),
          }),
          { id: `restore-fallback-${chatId}` },
        );

        // Skip persist if appId is not available (no chat has appId=0)
        if (!appId) {
          console.warn(
            `Skipping chat mode persist for chat ${chatId}: appId not available`,
          );
          // Still apply the resolved mode to settings even without DB persistence
          shouldUpdateSelectedChatMode = true;
        } else {
          const persistResult = await persistChatMode({
            chatId,
            appId,
            chatMode: resolvedMode.mode,
            optimistic: false,
            onPersistSuccess: () =>
              queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
            onPersistError: (error) => {
              console.error("Failed to persist restored chat mode:", error);
              toast.error(
                t("chatMode.persistFailed", {
                  defaultValue: "Failed to save chat mode to database",
                }),
                { id: `persist-fail-${chatId}` },
              );
            },
          });

          if (!isCancelled) {
            setIsRestoringMode(false);
          }

          if (
            !isCancelled &&
            !restoreAbortController.signal.aborted &&
            persistResult.success &&
            persistResult.sameRoute
          ) {
            shouldUpdateSelectedChatMode = true;
          }
        }
      } else if (!isCancelled && !restoreAbortController.signal.aborted) {
        shouldUpdateSelectedChatMode = true;
      }

      if (
        shouldUpdateSelectedChatMode &&
        !isCancelled &&
        !restoreAbortController.signal.aborted &&
        snapshottedSettings.selectedChatMode !== resolvedMode.mode
      ) {
        await updateSettings({ selectedChatMode: resolvedMode.mode }).catch(
          (error) => {
            console.error("Failed to restore selected chat mode:", error);
          },
        );
      }
    };

    const runRestore = async () => {
      try {
        const cachedChats = queryClient.getQueryData<ChatSummary[]>(
          queryKeys.chats.list({ appId: appId ?? null }),
        );
        const cachedChat = cachedChats?.find((c) => c.id === chatId);

        if (cachedChat) {
          await applyResolvedMode(cachedChat.chatMode ?? null);
          return;
        }

        if (isCancelled) return;
        bannerTimeoutId = window.setTimeout(setBannerVisible, 200);

        const chat = await ipc.chat.getChat(chatId);
        if (isCancelled || restoreAbortController.signal.aborted) {
          return;
        }

        await applyResolvedMode(chat.chatMode ?? null);
      } catch (err) {
        console.error("Failed to restore chat mode on deep-link:", err);
        if (!isCancelled) {
          clearRestoreTimeout();
          setIsRestoringMode(false);
        }
      }
    };

    void runRestore();

    return () => {
      isCancelled = true;
      restoreAbortController.abort();
      clearRestoreTimeout();
    };
  }, [
    chatId,
    appId,
    settings,
    isQuotaExceeded,
    persistChatMode,
    queryClient,
    t,
    updateSettings,
    // Note: envVars omitted from deps to avoid excessive re-runs; handled by snapshot
  ]);

  return { isRestoringMode };
}
