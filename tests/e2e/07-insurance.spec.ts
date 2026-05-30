import { test, expect } from "@playwright/test";

test.describe("7. Insurance / COIs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/insurance");
  });

  test("insurance page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/insurance/);
    await expect(
      page.getByText(/insurance|coi|certificate/i).first()
    ).toBeVisible({ timeout: 8000 });
  });

  test("COI records or status indicators are visible", async ({ page }) => {
    // Mock data has insurance records with expiry dates
    await expect(
      page.getByText(/expire|valid|pending|expired|active|coi/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
