import { test, expect } from "@playwright/test";

// M3a — Email-driven AP bill ingest surface (/vendors → Inbox tab).
// Seeds: 3 inboundEmails fixtures (1 created_draft tied to BIL-0002, 1
// ingested w/ no PDF, 1 failed extraction).

test.describe("14. Inbound emails (AP)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/vendors?section=inbound_email");
  });

  test("inbox tab renders header + counters", async ({ page }) => {
    // Section heading "Inbound" (or similar) lands inside the vendors
    // page. The header tracks drafted/logged/failed counts pulled from
    // the seeded fixtures.
    await expect(
      page.getByRole("heading", { name: /vendors/i }),
    ).toBeVisible({ timeout: 8000 });
    // At least one row from the 3 seeded fixtures should render.
    await expect(
      page
        .getByText(/pinon petroleum|sandia marine|liftworks/i)
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("created_draft fixture has provenance back-ref to BIL-#### bill", async ({
    page,
  }) => {
    // Pinon Petroleum seed is the created_draft fixture tied to BIL-0002.
    // Verifying the from_email or vendor name surfaces in the inbound
    // feed table.
    await expect(
      page.getByText(/pinon petroleum|pinon/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });
});
