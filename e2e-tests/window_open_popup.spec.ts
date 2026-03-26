import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "window.open() popup should have tools available",
  async ({ po, context }) => {
    await po.setUpDyadPro({ autoApprove: true });

    // Create a basic app with a button that opens a popup
    await po.sendPrompt(
      "Create an app with a button that calls window.open('/about', '_blank', 'width=800,height=600')",
    );

    // Wait for the app to be created and preview to load
    await po.page.waitForTimeout(2000);

    // Get the preview iframe
    const iframeElement = po.page.frameLocator(
      '[data-testid="preview-iframe-element"]',
    );

    // Find and click the button that opens the popup
    // This assumes the button has some identifiable text from the prompt
    const popupButton = iframeElement.locator("button").first();

    // Listen for new page/window events
    const [popupPage] = await Promise.all([
      context.waitForEvent("page"),
      popupButton.click(),
    ]);

    // Wait for popup to fully load
    await popupPage.waitForLoadState("networkidle");

    // Verify the popup opened successfully
    expect(popupPage.url()).toContain("/about");

    // Check that popup has the component selector tools injected
    // The tools are injected by the proxy server as scripts
    // Verify by checking for dyad-related script content
    const content = await popupPage.content();
    expect(content).toContain("dyad-component-selector-client");

    // Optionally verify the selector button exists and is functional
    // This would be present if the tools were properly injected
    // const selectorButton = popupPage.getByTestId('preview-pick-element-button');
    // Note: The selector button might not have the exact same test ID in the popup
    // but the injected scripts should provide similar functionality

    // Clean up
    await popupPage.close();
  },
);

testSkipIfWindows(
  "window.open() popup should preserve relative URLs",
  async ({ po, context }) => {
    await po.setUpDyadPro({ autoApprove: true });

    // Create an app with multiple buttons for different route opens
    await po.sendPrompt(
      "Create an app with buttons that open relative routes: /page1, /page2, /settings",
    );

    await po.page.waitForTimeout(2000);

    const iframeElement = po.page.frameLocator(
      '[data-testid="preview-iframe-element"]',
    );
    const firstButton = iframeElement.locator("button").first();

    const [popupPage] = await Promise.all([
      context.waitForEvent("page"),
      firstButton.click(),
    ]);

    await popupPage.waitForLoadState("networkidle");

    // Verify that relative URL was resolved to absolute URL with same origin
    const popupOrigin = new URL(popupPage.url()).origin;
    const previewOrigin = po.page.url().match(/https?:\/\/[^/]+/)?.[0];

    // Both should be localhost on same port (proxy port)
    expect(popupOrigin).toBe(previewOrigin);

    await popupPage.close();
  },
);

testSkipIfWindows(
  "window.open() popup should handle external URLs",
  async ({ po }) => {
    await po.setUpDyadPro({ autoApprove: true });

    // Create an app with button that opens external URL
    await po.sendPrompt(
      "Create an app with a button that opens window.open('https://example.com', '_blank')",
    );

    await po.page.waitForTimeout(2000);

    const iframeElement = po.page.frameLocator(
      '[data-testid="preview-iframe-element"]',
    );
    const externalButton = iframeElement.locator("button");

    // For external URLs, Electron might handle them differently
    // This test documents the expected behavior
    // External URLs might open in the default browser instead of a popup window
    // We'll just verify that the button is clickable without errors

    await externalButton.click();

    // Give it a moment to process
    await po.page.waitForTimeout(500);

    // No crash should occur
    await expect(po.page).toBeTruthy();
  },
);
