import { test, expect, devices } from "@playwright/test";

// PWA regression guard — Marina Stee targets mobile-first (/dock is the install target).
// Every listed page must render without forcing body-level horizontal scroll.
test.use({
  viewport: devices["iPhone 13"].viewport,
  userAgent: devices["iPhone 13"].userAgent,
});

const PAGES_TO_CHECK: { path: string; readyText: RegExp }[] = [
  { path: "/",             readyText: /slip|reservations|work orders/i },
  { path: "/dock",         readyText: /dock|slip/i },
  { path: "/members",      readyText: /members|Emmons|Peterson/i },
  { path: "/reservations", readyText: /reservations/i },
  { path: "/work-orders",  readyText: /work orders/i },
  { path: "/inbox",        readyText: /inbox/i },
];

test.describe("12. Mobile — no horizontal page overflow", () => {
  for (const { path, readyText } of PAGES_TO_CHECK) {
    test(`${path} fits the viewport without horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText(readyText).first()).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(300);

      const { bodyScroll, viewport } = await page.evaluate(() => ({
        bodyScroll: document.body.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));

      expect(
        bodyScroll,
        `body.scrollWidth (${bodyScroll}) exceeds viewport (${viewport}) on ${path}`,
      ).toBeLessThanOrEqual(viewport + 1);
    });
  }
});
