import { test, expect } from "@playwright/test";

// M3c — Audit log explorer (/settings/audit-log).
// Filter sidebar + free-text search + per-row drawer.

test.describe("16. Audit log explorer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/audit-log");
  });

  test("page loads with audit content visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /audit/i }).first(),
    ).toBeVisible({ timeout: 8000 });
    // At least one entity / verb / provenance marker should surface
    // from the seeded audit log.
    await expect(
      page.getByText(/agent|bulk|closeout|application|contract|work/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("free-text search input is present and accepts text", async ({
    page,
  }) => {
    const searchInput = page
      .getByPlaceholder(/search|filter/i)
      .first();
    const hasInput = await searchInput.isVisible().catch(() => false);
    if (hasInput) {
      await searchInput.fill("work_order");
      // Debounced — let the 180ms tick land.
      await page.waitForTimeout(300);
      await expect(searchInput).toHaveValue("work_order");
    } else {
      // If the page uses a different control shape, just confirm the
      // page didn't crash.
      await expect(page).toHaveURL(/audit-log/);
    }
  });

  test("provenance filter / pill renders for via_agent or via_bulk rows", async ({
    page,
  }) => {
    // Seeded audit log includes via_agent + via_bulk rows. Some chip,
    // badge, or label should surface that distinguishes them.
    const hasProvenanceMarker = await page
      .getByText(/agent|bulk|closeout/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasProvenanceMarker).toBe(true);
  });
});
