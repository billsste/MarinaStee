import { test, expect } from "@playwright/test";

test.describe("10. Inbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inbox");
  });

  test("inbox page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.getByText(/inbox/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("message threads are visible", async ({ page }) => {
    // Mock data has messages from Emmons and Peterson
    await expect(
      page.getByText(/Emmons|Peterson|message|thread/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
