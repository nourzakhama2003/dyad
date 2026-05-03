import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import Layout from "../app/layout";
import { useEffect, useRef } from "react";
import { useSelectChat } from "../hooks/useSelectChat";
import { ipc } from "../ipc/types";
import { systemClient } from "../ipc/types/system";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "../atoms/chatAtoms";
import { showWarning } from "../lib/toast";

import { resolveAppIdForChat, resolveAppNameForChat } from "../lib/chatUtils";

import { useSettings } from "../hooks/useSettings";

export const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <NotificationHandler />
      <Outlet />
    </Layout>
  ),
});

/**
 * Handles all OS-level notifications (Completions, Agent Consent, MCP Consent).
 * Listens for browser events for completions and IPC events for consent.
 */
function NotificationHandler() {
  const { selectChat } = useSelectChat();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const selectedChatId = useAtomValue(selectedChatIdAtom);

  const selectChatRef = useRef(selectChat);
  const selectedChatIdRef = useRef(selectedChatId);
  const notificationsEnabled = settings?.enableChatEventNotifications === true;

  // Track notifications and timers for deduplication/auto-close
  const autoCloseTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>(),
  );
  const notificationsRef = useRef(new Map<number, Notification>());

  useEffect(() => {
    selectChatRef.current = selectChat;
  }, [selectChat]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  // Shared helper for showing/closing native notifications
  const showNativeNotification = async (params: {
    chatId: number;
    title: string;
    body: string;
    tag: string;
    requireInteraction?: boolean;
    autoClose?: boolean;
  }) => {
    const { chatId, title, body, tag, requireInteraction, autoClose } = params;

    // Deduplicate
    notificationsRef.current.get(chatId)?.close();
    const existingTimer = autoCloseTimersRef.current.get(chatId);
    if (existingTimer) clearTimeout(existingTimer);

    const notification = new Notification(title, {
      body,
      tag,
      requireInteraction,
    });
    notificationsRef.current.set(chatId, notification);

    if (autoClose) {
      const timer = setTimeout(() => {
        notification.close();
        autoCloseTimersRef.current.delete(chatId);
        notificationsRef.current.delete(chatId);
      }, 10000);
      autoCloseTimersRef.current.set(chatId, timer);
    }

    notification.onclick = async () => {
      systemClient.focusWindow();
      window.focus();
      const appId = await resolveAppIdForChat(chatId, queryClient);
      if (appId) {
        selectChatRef.current({ chatId, appId });
      }
      notification.close();
    };
  };

  // 1. Chat Completion Listener (Custom Event)
  useEffect(() => {
    const handleCompletion = async (event: any) => {
      const { chatId, title } = event.detail;
      const isDifferentChat = selectedChatIdRef.current !== chatId;

      if (
        notificationsEnabled &&
        Notification.permission === "granted" &&
        (!document.hasFocus() || isDifferentChat)
      ) {
        const appName = await resolveAppNameForChat(chatId, queryClient);
        showNativeNotification({
          chatId,
          title: appName,
          body: title ?? "Chat response completed",
          tag: `dyad-chat-complete-${chatId}`,
          autoClose: true,
        });
      }
    };

    window.addEventListener("dyad-stream-completion" as any, handleCompletion);
    return () =>
      window.removeEventListener(
        "dyad-stream-completion" as any,
        handleCompletion,
      );
  }, [queryClient, notificationsEnabled]);

  // 2. Agent Tool Consent Listener (IPC)
  useEffect(() => {
    const unsubscribe = ipc.events.agent.onConsentRequest(async (payload) => {
      let currentPermission =
        typeof Notification !== "undefined"
          ? Notification.permission
          : "denied";
      if (currentPermission === "default")
        currentPermission = await Notification.requestPermission();

      const isDifferentChat = selectedChatIdRef.current !== payload.chatId;

      // Fallback Warning (Urgent)
      if (
        currentPermission !== "granted" &&
        (!document.hasFocus() || isDifferentChat)
      ) {
        showWarning(
          `"${payload.toolName}" needs your approval. OS notifications are not granted.`,
        );
      }

      // OS Notification (Urgent - Bypasses Informational Toggle)
      if (
        currentPermission === "granted" &&
        (!document.hasFocus() || isDifferentChat)
      ) {
        const appName = await resolveAppNameForChat(
          payload.chatId,
          queryClient,
        );
        const MAX_BODY = 60;
        const bodyContext =
          payload.inputPreview ||
          payload.toolDescription ||
          "Needs your approval";
        const spaceIdx = bodyContext.lastIndexOf(" ", MAX_BODY);
        const trimmed =
          bodyContext.length > MAX_BODY
            ? bodyContext.slice(0, spaceIdx > 0 ? spaceIdx : MAX_BODY) + "…"
            : bodyContext;

        showNativeNotification({
          chatId: payload.chatId,
          title: appName,
          body: `"${payload.toolName}": ${trimmed}`,
          tag: `dyad-agent-consent-${payload.chatId}`,
          requireInteraction: true,
        });
      }
    });
    return () => unsubscribe();
  }, [queryClient]);

  // 3. MCP Tool Consent Listener (IPC)
  useEffect(() => {
    const unsubscribe = ipc.events.mcp.onConsentRequest(async (payload) => {
      let currentPermission =
        typeof Notification !== "undefined"
          ? Notification.permission
          : "denied";
      if (currentPermission === "default")
        currentPermission = await Notification.requestPermission();

      const isDifferentChat = payload.chatId
        ? selectedChatIdRef.current !== payload.chatId
        : false;

      // Fallback Warning (Urgent)
      if (
        currentPermission !== "granted" &&
        (!document.hasFocus() || isDifferentChat)
      ) {
        const target = payload.serverName || payload.serverId;
        showWarning(
          `"${payload.toolName}" from "${target}" needs your approval. OS notifications are not granted.`,
        );
      }

      // OS Notification (Urgent - Bypasses Informational Toggle)
      if (
        currentPermission === "granted" &&
        (!document.hasFocus() || isDifferentChat)
      ) {
        const tagId =
          payload.chatId ?? `${payload.serverId}-${payload.toolName}`;
        const title = payload.chatId
          ? await resolveAppNameForChat(payload.chatId, queryClient)
          : "Dyad";

        const MAX_BODY = 60;
        const bodyContext =
          payload.inputPreview ||
          payload.toolDescription ||
          "Needs your approval";
        const spaceIdx = bodyContext.lastIndexOf(" ", MAX_BODY);
        const trimmed =
          bodyContext.length > MAX_BODY
            ? bodyContext.slice(0, spaceIdx > 0 ? spaceIdx : MAX_BODY) + "…"
            : bodyContext;

        showNativeNotification({
          chatId: payload.chatId ?? 0,
          title,
          body: `"${payload.toolName}": ${trimmed}`,
          tag: `dyad-mcp-consent-${tagId}`,
          requireInteraction: true,
        });
      }
    });
    return () => unsubscribe();
  }, [queryClient]);

  return null;
}
