import { test, expect } from "@playwright/test";

// Recurring-cleaning chain coverage. Locks the 6 fixes from the
// code-review pass that landed in lib/recurring-cleaning.ts +
// lib/agent-actions.ts + the cleaning-source-panel + recurring-preview:
//
//   1. create_work_order returns wo.id (walker bookkeeping runs)
//   2. spawned children are is_recurring=false (no geometric blowup)
//   3. cadence math lives in ONE module (no drift between WO action +
//      walker)
//   4. month-end clamp — Jan 31 + 1 month → Feb 28 (NOT Mar 3)
//   5. structured cleaning_source_kind/id columns are read first
//   6. walker prefers structured columns over notes-prefix parsing
//
// Seeds: wo_jones_weekly_clean (weekly, anchor 2026-01-01),
// wo_jones_monthly_deep (monthly, anchor 2026-01-31). Both anchors are
// deep in the past so the walker has work to do on every load.

const ADVANCE_BTN = /advance recurring cleanings/i;
const RESULT_TWO = /spawned 2 cleaning wos\./i;
const RESULT_ANY = /spawned \d+ cleaning|no recurring/i;

test.describe("13. Recurring cleaning chain", () => {
  test("walker advances anchor by one cadence step", async ({ page }) => {
    await page.goto("/work-orders/wo_jones_weekly_clean");

    // The recurring-preview's LocalTime uses fmt="weekday" — "Thursday,
    // Jan 1". The identity-bar badge uses fmt="short_date" — "Jan 1".
    // Scope to the long form so only the preview matches.
    // Pre-click: recurring_next_date = 2026-01-01 (a Thursday).
    await expect(page.getByText(/thursday, jan 1\b/i)).toBeVisible({ timeout: 8000 });

    // Walker runs. Weekly + monthly both fire — result confirms 2 spawned.
    await page.getByRole("button", { name: ADVANCE_BTN }).click();
    await expect(page.getByText(RESULT_TWO)).toBeVisible({ timeout: 4000 });

    // recurring_next_date advances 7 days → preview now shows Thursday, Jan 8.
    // The preview hook reads the store-stamped field directly (fix #10
    // in recurring-preview.tsx) so the update is immediate without a
    // page reload.
    await expect(page.getByText(/thursday, jan 8\b/i)).toBeVisible({ timeout: 4000 });
  });

  test("5 advances spawn 2 each — no geometric blowup", async ({ page }) => {
    await page.goto("/work-orders/wo_jones_weekly_clean");
    const btn = page.getByRole("button", { name: ADVANCE_BTN });
    await expect(btn).toBeVisible({ timeout: 8000 });

    // Click 5 times; each click should report "Spawned 2 cleaning WOs."
    // because the source WOs are still in the past after each step (weekly
    // walks 7d, monthly walks 1mo). Geometric blowup — where spawned
    // children inherited is_recurring=true and re-spawned themselves —
    // would produce 2, 4, 8, 16, 32 (the fix sets child is_recurring=false).
    for (let i = 0; i < 5; i++) {
      await btn.click();
      await expect(page.getByText(RESULT_TWO)).toBeVisible({ timeout: 4000 });
      // Small gap so result text re-renders cleanly between clicks.
      await page.waitForTimeout(80);
    }
  });

  test("month-end clamp: Jan 31 monthly → Feb 28, NOT Mar 3", async ({ page }) => {
    await page.goto("/work-orders/wo_jones_monthly_deep");

    // Pre-click: recurring_next_date = 2026-01-31 (a Saturday) → preview
    // shows "Saturday, Jan 31". Scope to the long weekday-prefixed form
    // (the description and identity badge also contain "Jan 31").
    await expect(page.getByText(/saturday, jan 31/i)).toBeVisible({ timeout: 8000 });

    await page.getByRole("button", { name: ADVANCE_BTN }).click();
    await expect(page.getByText(RESULT_ANY)).toBeVisible({ timeout: 4000 });

    // Post-click: anchor advances ONE month with day-clamp →
    // Saturday, Feb 28 (Feb 2026 has 28 days). The naive
    // `setUTCMonth(+1)` would have overflowed to Tuesday, Mar 3.
    await expect(page.getByText(/saturday, feb 28/i)).toBeVisible({ timeout: 4000 });
    await expect(page.getByText(/tuesday, mar 3\b/i)).toHaveCount(0);
  });

  test("structured cleaning_source columns render Source panel", async ({ page }) => {
    // wo_peterson_clean carries `cleaning_source_kind: "club_booking"` +
    // `cleaning_source_id: "cb_001"` as structured columns. It has NO
    // `Source: …` prefix in internal_notes — so the panel can only
    // render when the structured-fields-first lookup (fix #5) is in
    // place. Pre-fix this test would have failed: the legacy parser
    // returns undefined and the panel short-circuits to null.
    await page.goto("/work-orders/wo_peterson_clean");

    // Panel header.
    await expect(page.getByText(/^source$/i)).toBeVisible({ timeout: 8000 });
    // The Source card renders as a Link with accessible name aggregating
    // the kind label + the id — locating by role here disambiguates from
    // the description text that also mentions "cb_001".
    await expect(
      page.getByRole("link", { name: /club booking cb_001/i }),
    ).toBeVisible();
  });
});
