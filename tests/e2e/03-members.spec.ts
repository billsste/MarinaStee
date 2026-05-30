import { test, expect } from "@playwright/test";

test.describe("3. Members", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/members");
  });

  test("members page loads with boater records", async ({ page }) => {
    await expect(page).toHaveURL(/\/members/);
    // Mock data has at least David Emmons and Sarah Peterson
    await expect(page.getByText(/Emmons/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("Peterson appears in the member list", async ({ page }) => {
    await expect(page.getByText(/Peterson/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("member list has clickable rows or cards", async ({ page }) => {
    // At least one link or button to a member profile
    const memberLink = page.locator("a, button, [role='row']").filter({ hasText: /Emmons|Peterson/i }).first();
    await expect(memberLink).toBeVisible();
  });

  test("agent input is present on members page", async ({ page }) => {
    await expect(
      page.getByPlaceholder(/Message Marina Stee|Search|Find/i).first()
    ).toBeVisible();
  });
});
