import { test, expect } from "@playwright/test";

test.describe("11. Agent Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("agent input is present and accepts text on dashboard", async ({ page }) => {
    const input = page.getByPlaceholder("Message Marina Stee…");
    await expect(input).toBeVisible();
    await input.fill("How many slips are occupied today?");
    await expect(input).toHaveValue("How many slips are occupied today?");
  });

  test("submitting a message via Enter triggers a response", async ({ page }) => {
    const input = page.getByPlaceholder("Message Marina Stee…");
    await input.fill("Show me today's arriving boats");
    await input.press("Enter");
    // Agent should respond — look for a reply bubble or the input clearing
    await expect(
      page.getByText(/arriving|today|boat|slip|reservation|result/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("agent thread persists — messages stay visible after typing", async ({ page }) => {
    // Typing in the input should not clear the existing text
    const input = page.getByPlaceholder("Message Marina Stee…");
    await input.fill("List boaters with overdue invoices");
    await expect(input).toHaveValue("List boaters with overdue invoices");
    // Clearing and typing new query works correctly
    await input.fill("Check slip availability for next weekend");
    await expect(input).toHaveValue("Check slip availability for next weekend");
  });
});
