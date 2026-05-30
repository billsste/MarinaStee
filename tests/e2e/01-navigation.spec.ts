import { test, expect } from "@playwright/test";

// All major pages should load without crashing (200 / render).
// Marina Stee runs in mock-data mode — no auth wall, no DB.

const PAGES = [
  { path: "/",              ready: /slip occupancy|reservations|work orders/i },
  { path: "/members",       ready: /members/i },
  { path: "/reservations",  ready: /reservations/i },
  { path: "/work-orders",   ready: /work orders/i },
  { path: "/ledger",        ready: /ledger|billing|pos/i },
  { path: "/insurance",     ready: /insurance|coi/i },
  { path: "/boat-rentals",  ready: /boat rentals/i },
  { path: "/reports",       ready: /reports/i },
  { path: "/inbox",         ready: /inbox/i },
  { path: "/dock",          ready: /dock|slip/i },
  { path: "/settings",      ready: /settings/i },
];

test.describe("1. Navigation — all pages load", () => {
  for (const { path, ready } of PAGES) {
    test(`${path} renders without crashing`, async ({ page }) => {
      await page.goto(path);
      await expect(page).not.toHaveURL(/error|500/);
      await expect(page.getByText(ready).first()).toBeVisible({ timeout: 10000 });
    });
  }
});
