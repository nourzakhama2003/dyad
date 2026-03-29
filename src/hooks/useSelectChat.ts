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
import { ipc } from "@/ipc/types";
import log from "electron-log";

const logger = log.scope("useSelectChat");

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();
  const { updateSettings } = useSettings();

  return {
    selectChat: async ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Track this chat as opened in the current session
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }

      // Restore chat mode if it was saved for this chat
      try {
        const chat = await ipc.chat.getChat(chatId);
        // If the chat has a saved chatMode, apply it
        if (chat.chatMode) {
          await updateSettings({ selectedChatMode: chat.chatMode });
        }
        // Otherwise, keep the current selected mode
        // (backward compat for chats created before this feature)
      } catch (error) {
        logger.error("Error fetching chat mode:", error);
        // Continue with current mode if fetch fails
      }

      const navigationResult = navigate({
        to: "/chat",
        search: { id: chatId },
      });

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
