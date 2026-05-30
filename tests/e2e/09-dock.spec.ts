import { test, expect } from "@playwright/test";

test.describe("9. Dock View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dock");
  });

  test("dock page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/dock/);
    await expect(page.getByText(/dock|slip/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("slip grid or map renders with slip identifiers", async ({ page }) => {
    // Mock data uses slip IDs like "A04", "A29", "T-01" (letter + digits).
    await expect(
      page.getByText(/[A-Z]\d{1,4}|[A-Z]-\d+/i).first()
    ).toBeVisible({ timeout: 8000 });
  });

  test("check-in or slip status controls are visible", async ({ page }) => {
    await expect(
      page.getByText(/check.?in|occupied|vacant|available|status/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
