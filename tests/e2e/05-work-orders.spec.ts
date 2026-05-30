import { test, expect } from "@playwright/test";

test.describe("5. Work Orders", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/work-orders");
  });

  test("work orders page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/work-orders/);
    await expect(page.getByText(/work orders/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("work order list has entries", async ({ page }) => {
    // Mock data has seeded work orders
    const rows = page.locator("tr, [role='row'], [data-row], li").filter({ hasText: /open|scheduled|in_progress|blocked|complete|urgent/i });
    await expect(rows.first()).toBeVisible({ timeout: 8000 });
  });

  test("status filter or tab controls are present", async ({ page }) => {
    // Work orders have status filters (All / Open / Closed etc.)
    const filter = page.getByRole("button", { name: /all|open|closed|complete|filter/i }).first();
    await expect(filter).toBeVisible();
  });

  test("New Work Order button is accessible", async ({ page }) => {
    const btn = page.getByRole("button", { name: /new|add|create|work order/i }).first();
    await expect(btn).toBeVisible();
  });
});
