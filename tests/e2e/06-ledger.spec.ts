import { test, expect } from "@playwright/test";

test.describe("6. Ledger / POS", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ledger");
  });

  test("ledger page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/ledger/);
    await expect(page.getByText(/ledger|billing|orders|pos/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("ledger has money amounts or transaction rows", async ({ page }) => {
    // Mock data has invoices and ledger entries
    await expect(page.getByText(/\$[\d,]+|\d+\.\d{2}/).first()).toBeVisible({ timeout: 8000 });
  });

  test("billing runs or POS section renders", async ({ page }) => {
    await expect(
      page.getByText(/billing runs|pos terminal|orders/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
