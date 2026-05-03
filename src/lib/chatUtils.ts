import { QueryClient } from "@tanstack/react-query";
import { ChatSummary } from "./schemas";
import { queryKeys } from "./queryKeys";
import { ipc } from "../ipc/types";

/**
 * Resolves the appId for a given chatId by checking the TanStack Query cache
 * and falling back to a direct IPC fetch if necessary.
 */
export async function resolveAppIdForChat(
  chatId: number,
  queryClient: QueryClient,
): Promise<number | null> {
  const chatsCaches = queryClient.getQueriesData<ChatSummary[]>({
    queryKey: queryKeys.chats.all,
  });

  for (const [, cachedChats] of chatsCaches) {
    if (!Array.isArray(cachedChats)) continue;
    const found = cachedChats.find((c) => c.id === chatId);
    if (found) return found.appId;
  }

  try {
    const chat = await ipc.chat.getChat(chatId);
    return chat.appId;
  } catch (error) {
    console.warn(`[NOTIF] Failed to fetch appId for chat ${chatId}:`, error);
    return null;
  }
}

/**
 * Attempts to resolve an app name for a given chatId.
 * Searches the local cache first, then falls back to an IPC call.
 */
export async function resolveAppNameForChat(
  chatId: number,
  queryClient: QueryClient,
): Promise<string> {
  // 1. Resolve the appId first (shared logic)
  const appId = await resolveAppIdForChat(chatId, queryClient);

  if (appId) {
    const app = queryClient.getQueryData<{ name: string } | null>(
      queryKeys.apps.detail({ appId }),
    );
    if (app?.name) return app.name;

    // 2. Fallback to IPC if not in cache
    try {
      const app = await ipc.app.getApp(appId);
      return app?.name ?? "Dyad";
    } catch (error) {
      console.error("[CHAT_UTILS] Failed to resolve app name via IPC:", error);
    }
  }

  return "Dyad";
}
