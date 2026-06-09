import { test, expect } from "@playwright/test";

test.describe("4. Reservations", () => {
  test.beforeEach(async ({ page }) => {
    // /reservations was consolidated into /bookings → Slip Reservations
    // sub-tab. The old route stub redirects to /bookings?tab=slips so
    // existing bookmarks and external links keep working.
    await page.goto("/reservations");
  });

  test("reservations URL redirects into the bookings surface", async ({ page }) => {
    await expect(page).toHaveURL(/\/bookings/);
    await expect(
      page.getByRole("heading", { name: /^bookings$/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("reservation list has at least one entry", async ({ page }) => {
    // Mock data has seeded reservations — they render as activity rows
    // in the unified kanban / day strip.
    const rows = page
      .locator("tr, [role='row'], li, [data-row], a")
      .filter({ hasText: /slip|arrive|depart|boater|reservation|booking/i });
    await expect(rows.first()).toBeVisible({ timeout: 8000 });
  });

  test("a New Reservation or Add button is accessible", async ({ page }) => {
    const addBtn = page
      .getByRole("button", { name: /new|add|create|reservation|booking/i })
      .first();
    await expect(addBtn).toBeVisible();
  });
});
