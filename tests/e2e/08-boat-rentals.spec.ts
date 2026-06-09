import { test, expect } from "@playwright/test";

test.describe("8. Boat Rentals", () => {
  test.beforeEach(async ({ page }) => {
    // /boat-rentals (the landing list) was consolidated into /bookings
    // → Fleet Bookings sub-tab. The per-boat detail page (/boat-rentals/
    // [id]) and the booking wizard (/boat-rentals/book) still live at
    // those routes — only the landing list moved.
    await page.goto("/boat-rentals");
  });

  test("boat-rentals URL redirects into the bookings surface", async ({ page }) => {
    await expect(page).toHaveURL(/\/bookings/);
    await expect(
      page.getByRole("heading", { name: /^bookings$/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("rental inventory or availability section renders", async ({ page }) => {
    await expect(
      page.getByText(/available|rental|boat|vessel|fleet|booking/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });
});
