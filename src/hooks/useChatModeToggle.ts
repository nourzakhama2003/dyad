import { useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import { useShortcut } from "./useShortcut";
import { usePostHog } from "posthog-js/react";
import { ChatModeSchema } from "../lib/schemas";
import { ipc } from "@/ipc/types";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useChatModeToggle() {
  const { settings, updateSettings } = useSettings();
  const posthog = usePostHog();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Memoize chatId to prevent recreation on every render (which would break useCallback)
  const chatId = useMemo(() => {
    if (!router.state.location.pathname.startsWith("/chat")) return undefined;
    const searchParams = new URLSearchParams(router.state.location.search);
    const id = searchParams.get("id");
    return id ? { id: parseInt(id, 10) } : undefined;
  }, [router.state.location.pathname, router.state.location.search]);

  // Detect if user is on mac
  const isMac = useIsMac();

  // Memoize the modifiers object to prevent re-registration
  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
    }),
    [isMac],
  );

  // Function to toggle between chat modes
  const toggleChatMode = useCallback(async () => {
    if (!settings || !settings.selectedChatMode) return;

    const currentMode = settings.selectedChatMode;
    // Migration on read ensures currentMode is never "agent"
    const modes = ChatModeSchema.options;
    const currentIndex = modes.indexOf(currentMode);
    const newMode = modes[(currentIndex + 1) % modes.length];

    updateSettings({ selectedChatMode: newMode });
    posthog.capture("chat:mode_toggle", {
      from: currentMode,
      to: newMode,
      trigger: "keyboard_shortcut",
    });

    // Persist to chat if we're in a chat
    if (chatId?.id) {
      try {
        await ipc.chat.updateChatMode({
          chatId: chatId.id,
          chatMode: newMode,
        });
        // Invalidate chat cache so stale mode isn't restored on tab switch
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      } catch (error) {
        console.error("Failed to persist keyboard shortcut mode change:", error);
      }
    }
  }, [settings, updateSettings, posthog, chatId]);

  // Add keyboard shortcut with memoized modifiers
  useShortcut(
    ".",
    modifiers,
    toggleChatMode,
    true, // Always enabled since we're not dependent on component selector
  );

  return { toggleChatMode, isMac };
}

// Add this function at the top
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUserAgentData;
  // Try modern API first
  if ("userAgentData" in nav && nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  // Fallback to user agent check
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
// Export the utility function and hook for use elsewhere
export function useIsMac(): boolean {
  return useMemo(() => detectIsMac(), []);
}
