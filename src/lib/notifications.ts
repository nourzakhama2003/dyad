/**
 * Dispatches a custom event to signal that a chat stream has completed.
 * This is picked up by the top-level NotificationHandler in root.tsx.
 */
export function notifyStreamCompletion(chatId: number, title?: string) {
  window.dispatchEvent(
    new CustomEvent("dyad-stream-completion", {
      detail: { chatId, title },
    }),
  );
}
