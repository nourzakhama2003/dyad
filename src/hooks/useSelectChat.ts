import { useRef } from "react";
import { useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";
import { useSettings } from "./useSettings";
import log from "electron-log";

const logger = log.scope("useSelectChat");

export function useSelectChat() {
  const settingsUpdateAbortRef = useRef<AbortController | null>(null);
  const currentModeUpdateChatIdRef = useRef<number | null>(null);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();
  const { updateSettings } = useSettings();

  return {
    selectChat: ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
      chatMode,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
      chatMode?: "ask" | "build" | "local-agent" | "plan" | null;
    }) => {
      // Cancel any previous in-flight updateSettings to prevent stale UI state
      // when user rapidly switches between chats with different modes
      if (settingsUpdateAbortRef.current) {
        settingsUpdateAbortRef.current.abort();
      }

      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Track this chat as opened in the current session
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }

      // Navigate immediately - don't block on async mode restoration
      const navigationResult = navigate({
        to: "/chat",
        search: { id: chatId },
      });

      // Restore chat mode async in the background if provided
      // This prevents navigation delays for large chats
      if (chatMode) {
        // Store ref so next selectChat call can abort this update if user switches again
        const abortController = new AbortController();
        settingsUpdateAbortRef.current = abortController;
        // Track which chat this mode update is for, to ignore stale updates
        currentModeUpdateChatIdRef.current = chatId;
        
        updateSettings({ selectedChatMode: chatMode })
          .catch((error) => {
            // Only log if this update was for the current chat
            if (currentModeUpdateChatIdRef.current === chatId && error?.name !== "AbortError") {
              logger.error("Error updating chat mode:", error);
            }
          });
      }

      if (prefillInput !== undefined) {
        Promise.resolve(navigationResult)
          .then(() => {
            setChatInputValue(prefillInput);
          })
          .catch(() => {
            // Ignore navigation errors here; navigation handling is centralized.
          });
      }
    },
  };
}
