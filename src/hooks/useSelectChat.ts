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
  const currentModeUpdateVersionRef = useRef<number>(0);
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
      // Increment version to invalidate any in-flight mode updates from previous chat selections
      // This prevents stale updateSettings calls from overwriting fresh ones when tabs are switched rapidly
      const updateVersion = ++currentModeUpdateVersionRef.current;
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
      if (chatMode) {
        //  apply mode update if this is still the current selection (version matches)
        updateSettings({ selectedChatMode: chatMode }).catch((error) => {
          //  if this update was for the current selection version log the error, otherwise ignore since it's stale
          if (updateVersion === currentModeUpdateVersionRef.current) {
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
