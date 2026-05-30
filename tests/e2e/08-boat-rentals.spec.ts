import { test, expect } from "@playwright/test";

test.describe("8. Boat Rentals", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/boat-rentals");
  });

  test("boat rentals page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/boat-rentals/);
    await expect(page.getByText(/boat rentals/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("rental inventory or availability section renders", async ({ page }) => {
    await expect(
      page.getByText(/available|rental|boat|vessel|fleet/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
