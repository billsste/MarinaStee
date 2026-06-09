import { test, expect } from "@playwright/test";

test.describe("2. Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("daily briefing panel renders", async ({ page }) => {
    // The dashboard was rebuilt: the old "Slip occupancy" KPI strip is
    // gone, replaced by AgentHero + AgentBrief + LiveDock + QuietList.
    // "Today's briefing" is the section eyebrow on AgentBrief — stable
    // across data shapes (renders even when all-quiet).
    await expect(page.getByText(/today's briefing/i).first()).toBeVisible({
      timeout: 8000,
    });
  });

  test("agent input renders with correct placeholder", async ({ page }) => {
    // Placeholder text changed when AgentHero was introduced. Use a
    // partial regex so future tweaks to the suggestion examples don't
    // re-break the test.
    const input = page.getByPlaceholder(/Ask Marina Stee/i);
    await expect(input).toBeVisible({ timeout: 8000 });
  });

  test("agent input accepts text", async ({ page }) => {
    const input = page.getByPlaceholder(/Ask Marina Stee/i);
    await input.fill("How many slips are occupied?");
    await expect(input).toHaveValue("How many slips are occupied?");
  });

  test("activity feed or recent events section renders", async ({ page }) => {
    // Dashboard shows recent activity (reservations, work orders, etc.)
    await expect(
      page.getByText(/today|arriving|recent|activity|work order|reservation/i).first()
    ).toBeVisible();
  });

  test("sidebar navigation is visible with key links", async ({ page }) => {
    // Sidebar links are icon-only with aria-label — use href to avoid matching
    // page-content links that share the same text (e.g. "Reservations" appears
    // both in the sidebar and in dashboard section headings).
    await expect(page.locator('a[href="/members"]').first()).toBeVisible();
    await expect(page.locator('a[href="/reservations"]').first()).toBeVisible();
    await expect(page.locator('a[href="/work-orders"]').first()).toBeVisible();
    await expect(page.locator('a[href="/ledger"]').first()).toBeVisible();
  });

  test("clicking Members nav link navigates to /members", async ({ page }) => {
    await page.getByRole("link", { name: /^Members$/i }).first().click();
    await expect(page).toHaveURL(/\/members/);
  });
});
