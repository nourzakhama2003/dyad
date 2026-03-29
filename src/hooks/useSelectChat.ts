import { useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
  activeChatModeAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";
import { useSettings } from "./useSettings";
import log from "electron-log";

const logger = log.scope("useSelectChat");

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const setActiveChatMode = useSetAtom(activeChatModeAtom);
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
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Set active chat mode synchronously to avoid race conditions with streaming
      setActiveChatMode(chatMode || null);
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
        updateSettings({ selectedChatMode: chatMode }).catch((error) => {
          logger.error("Error updating chat mode:", error);
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
