/**
 * Page object for chat-related actions.
 * Handles sending prompts, chat input, and chat mode selection.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class ChatActions {
  constructor(public page: Page) {}

  getHomeChatInputContainer() {
    return this.page.getByTestId("home-chat-input-container");
  }

  getChatInputContainer() {
    return this.page.getByTestId("chat-input-container");
  }

  getChatInput() {
    return this.page.locator(
      '[data-lexical-editor="true"][aria-placeholder^="Ask Dyad to build"]',
    );
  }

  /**
   * Clears the Lexical chat input using keyboard shortcuts (Meta+A, Backspace).
   * Uses toPass() for resilience since Lexical may need time to update its state.
   */
  async clearChatInput() {
    const chatInput = this.getChatInput();
    await chatInput.click();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.keyboard.press("Backspace");
    await expect(async () => {
      const text = await chatInput.textContent();
      expect(text?.trim()).toBe("");
    }).toPass({ timeout: Timeout.SHORT });
  }

  /**
   * Opens the chat history menu by clearing the input and pressing ArrowUp.
   * Uses toPass() for resilience since the Lexical editor may need time to
   * update its state before the history menu can be triggered.
   */
  async openChatHistoryMenu() {
    const historyMenu = this.page.locator('[data-mentions-menu="true"]');
    await expect(async () => {
      await this.clearChatInput();
      await this.page.keyboard.press("ArrowUp");
      await expect(historyMenu).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: Timeout.SHORT });
  }

  clickNewChat({ index = 0 }: { index?: number } = {}) {
    // There is two new chat buttons...
    return this.page.getByTestId("new-chat-button").nth(index).click();
  }

  private getRetryButton() {
    return this.page.getByRole("button", { name: "Retry" });
  }

  private getUndoButton() {
    return this.page.getByRole("button", { name: "Undo" });
  }

  async waitForChatCompletion() {
    await expect(this.getRetryButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }

  async clickRetry() {
    await this.getRetryButton().click();
  }

  async clickUndo() {
    await this.getUndoButton().click();
  }

  async sendPrompt(
    prompt: string,
    { skipWaitForCompletion = false }: { skipWaitForCompletion?: boolean } = {},
  ) {
    await this.getChatInput().click();
    await this.getChatInput().fill(prompt);
    await this.page.getByRole("button", { name: "Send message" }).click();
    if (!skipWaitForCompletion) {
      await this.waitForChatCompletion();
    }
  }

  async selectChatMode(
    mode: "build" | "ask" | "agent" | "local-agent" | "basic-agent" | "plan",
  ) {
    await this.page.getByTestId("chat-mode-selector").click();
    const mapping: Record<string, string> = {
      build: "Build Generate and edit code",
      ask: "Ask Ask",
      agent: "Build with MCP",
      "local-agent": "Agent v2",
      "basic-agent": "Basic Agent", // For free users
      plan: "Plan.*Design before you build",
    };
    const optionName = mapping[mode];
    await this.page
      .getByRole("option", {
        name: new RegExp(optionName),
      })
      .click();
  }

  /**
   * Get the current chat mode displayed in the mode selector.
   * Returns the visible text from the chat mode selector button.
   */
  async getChatMode(): Promise<string> {
    const modeSelector = this.page.getByTestId("chat-mode-selector");
    return await modeSelector.textContent() || "";
  }

  /**
   * Set the chat mode (alias for selectChatMode for convenience).
   */
  async setChatMode(
    mode: "build" | "ask" | "agent" | "local-agent" | "basic-agent" | "plan",
  ) {
    await this.selectChatMode(mode);
  }

  /**
   * Create a new chat by clicking the new chat button.
   */
  async createNewChat(options?: { index?: number }) {
    await this.clickNewChat(options);
    // Wait a moment for the chat to be created
    await this.page.waitForTimeout(500);
  }

  /**
   * Switch to a recent chat by index (1-based, where 1 is the most recent).
   * This clicks on the chat tab in the tab bar.
   */
  async switchToRecentChat(index: number) {
    // Get all chat tabs - they are usually in a container
    const chatTabs = this.page.locator('[data-testid*="chat-tab"]');
    const count = await chatTabs.count();

    // Validate index
    if (index < 1 || index > count) {
      throw new Error(
        `Invalid chat index ${index}. Only ${count} chats available.`,
      );
    }

    // Index is 1-based, but locator index is 0-based
    await chatTabs.nth(index - 1).click();
  }

  async selectLocalAgentMode() {
    await this.selectChatMode("local-agent");
  }

  async snapshotChatInputContainer() {
    await expect(this.getChatInputContainer()).toMatchAriaSnapshot();
  }
}
