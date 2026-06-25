import { chromium } from "playwright-core";

const baseUrl = process.env.HERMES_MONITOR_URL || "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

const viewports = [
  {
    name: "compact-desktop",
    viewport: { width: 1366, height: 768 },
    path: "/tmp/hermes-lens-compact.png",
  },
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    path: "/tmp/hermes-lens-desktop.png",
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    path: "/tmp/hermes-lens-mobile.png",
  },
];

try {
  for (const target of viewports) {
    const page = await browser.newPage({ viewport: target.viewport });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "hermes-lens-settings",
        JSON.stringify({
          compactActivity: false,
          restoreAutoScrollOnSessionSwitch: true,
          showHeartbeatsInDebug: false,
          showLifecycleEventsInDebug: true,
          theme: "hermes-dark",
        }),
      );
    });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".session-row").first().waitFor({ timeout: 10_000 });
    const sessionCount = await page.locator(".session-row").count();
    for (let index = 0; index < sessionCount; index += 1) {
      await page.locator(".session-row").nth(index).evaluate((element) => {
        element.click();
      });
      await page.waitForTimeout(600);
      if ((await page.locator(".event-block, .tool-block").count()) > 0) {
        break;
      }
    }
    if ((await page.locator(".event-block, .tool-block").count()) === 0) {
      await page.locator(".segmented-control button", { hasText: "debug" }).click();
    }
    await page.locator(".event-block, .tool-block").first().waitFor({
      timeout: 10_000,
    });

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (horizontalOverflow) {
      throw new Error(`${target.name} viewport has horizontal page overflow`);
    }
    const findHorizontalContainers = () => page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          ".timeline-scroll, .timeline-content, .turn-group, .chat-user-row, .chat-assistant-row, .chat-user-bubble, .chat-assistant-bubble, .tool-block, .tool-panel, .tool-section, .raw-section",
        ),
      )
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
    );
    let horizontalContainers = await findHorizontalContainers();
    if (horizontalContainers.length > 0) {
      throw new Error(
        `${target.name} has horizontally scrollable content: ${JSON.stringify(horizontalContainers)}`,
      );
    }
    if (consoleErrors.length > 0) {
      throw new Error(
        `${target.name} console errors:\n${consoleErrors.join("\n")}`,
      );
    }

    if (target.name !== "mobile") {
      const timelineBox = await page.locator(".timeline-scroll").boundingBox();
      if (!timelineBox || timelineBox.height > target.viewport.height) {
        throw new Error(`${target.name} timeline is not height-constrained`);
      }
      const toolHeaders = page.locator(".tool-block .tool-header");
      if ((await toolHeaders.count()) > 0) {
        await toolHeaders.first().click();
        horizontalContainers = await findHorizontalContainers();
        if (horizontalContainers.length > 0) {
          throw new Error(
            `${target.name} expanded tool has horizontal overflow: ${JSON.stringify(horizontalContainers)}`,
          );
        }
      }
      const inspectTarget = page
        .locator(
          ".event-detail-trigger, .event-block .event-body, .event-block .event-header",
        )
        .first();
      await inspectTarget.click();
      await page.locator(".detail-drawer").waitFor();
    }
    await page.screenshot({ path: target.path, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}
