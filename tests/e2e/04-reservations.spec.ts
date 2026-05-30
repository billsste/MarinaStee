import { test, expect } from "@playwright/test";

test.describe("4. Reservations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reservations");
  });

  test("reservations page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/reservations/);
    await expect(page.getByText(/reservations/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("reservation list has at least one entry", async ({ page }) => {
    // Mock data has seeded reservations
    const rows = page.locator("tr, [role='row'], li, [data-row]").filter({ hasText: /slip|arrive|depart|boater/i });
    await expect(rows.first()).toBeVisible({ timeout: 8000 });
  });

  test("a New Reservation or Add button is accessible", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: /new|add|create|reservation/i }).first();
    await expect(addBtn).toBeVisible();
  });
});
