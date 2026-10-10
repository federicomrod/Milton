import { describe, it, expect } from "vitest";
import {
  compactLastSync,
  formatLastSyncLine,
  friendlySkipReason,
  summarizeOdooSync,
  syncSummaryCopy,
  type OdooSyncSuccessBody,
} from "@/lib/restaurant/odoo/sync-summary";
import { safeSyncErrorMessage } from "@/lib/restaurant/odoo/sync-error";

const julyBody: OdooSyncSuccessBody = {
  synced_range: { start_date: "2026-07-01", end_date: "2026-07-31" },
  orders_fetched: 3815,
  lines_fetched: 21446,
  rows_upserted: 20089,
  rows_outside_requested_range_excluded: 1357,
  lines_skipped: [
    { reason: "Line has no order_id" },
    { reason: "Order not in a completed state (paid/done/invoiced)" },
    { reason: "Order not in a completed state (paid/done/invoiced)" },
  ],
  unmatched_menu_items: ["Taco pastor", "Agua de jamaica", "Flan"],
  unmatched_locations: ["Los Ranchos"],
  dimension_notes: ["pos.payment fields_get skipped optional field"],
};

describe("summarizeOdooSync + syncSummaryCopy", () => {
  it("renders a short human summary for the July 2026 staging shape", () => {
    const view = summarizeOdooSync(julyBody);
    const copy = syncSummaryCopy(view);

    expect(copy.headline).toBe(
      "Fetched 3,815 orders and saved 20,089 sales rows for 1 Jul 2026 – 31 Jul 2026."
    );
    expect(copy.skipped).toBe("3 rows were skipped.");
    expect(copy.unmatchedItems).toBe(
      "3 menu items did not match Milton’s menu."
    );
    expect(copy.unmatchedTills).toBe("1 till name is not a Milton location.");
    expect(copy.unmatchedTillsNote).toMatch(/informational/i);
    expect(copy.unmatchedTillsNote).toMatch(/company-to-location mapping/i);
    expect(copy.outsideRange).toMatch(/1,357 extra rows/);
    expect(view.warnings).toEqual([
      "pos.payment fields_get skipped optional field",
    ]);
    expect(view.unmatchedMenuItems).toEqual([
      "Taco pastor",
      "Agua de jamaica",
      "Flan",
    ]);
    expect(view.unmatchedLocations).toEqual(["Los Ranchos"]);
  });

  it("groups skip reasons into plain-language buckets", () => {
    const view = summarizeOdooSync(julyBody);
    expect(view.skippedGroups).toEqual([
      { reason: "Line was missing an order", count: 1 },
      { reason: "Order was not completed", count: 2 },
    ]);
  });

  it("uses empty-state copy when nothing was skipped or unmatched", () => {
    const view = summarizeOdooSync({
      synced_range: { start_date: "2026-10-09", end_date: "2026-10-09" },
      orders_fetched: 1,
      rows_upserted: 1,
      lines_skipped: [],
      unmatched_menu_items: [],
      unmatched_locations: [],
    });
    const copy = syncSummaryCopy(view);
    expect(copy.headline).toBe(
      "Fetched 1 order and saved 1 sales row for 9 Oct 2026."
    );
    expect(copy.skipped).toBe("No rows were skipped.");
    expect(copy.unmatchedItems).toBe(
      "Every synced item matched a Milton menu item."
    );
    expect(copy.unmatchedTills).toBe(
      "Every till name matched a Milton location."
    );
    expect(copy.outsideRange).toBeNull();
  });

  it("maps known skip reasons and falls back without exposing raw ids", () => {
    expect(friendlySkipReason("Line has no order_id")).toBe(
      "Line was missing an order"
    );
    expect(
      friendlySkipReason(
        "Till-name location (abc) conflicts with mapped location (xyz) for Odoo company 7"
      )
    ).toBe(
      "Till name pointed at a different location than the company mapping"
    );
    expect(friendlySkipReason("something unexpected from Odoo")).toBe(
      "Row could not be saved"
    );
  });
});

describe("compactLastSync", () => {
  it("stores counts and till names, never the unmatched item list", () => {
    const last = compactLastSync(
      julyBody,
      new Date("2026-10-10T12:00:00.000Z")
    );
    expect(last).toEqual({
      synced_at: "2026-10-10T12:00:00.000Z",
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      orders_fetched: 3815,
      rows_upserted: 20089,
      skipped_count: 3,
      unmatched_menu_item_count: 3,
      unmatched_locations: ["Los Ranchos"],
      warning_count: 1,
    });
    expect(JSON.stringify(last)).not.toContain("Taco pastor");
    expect(JSON.stringify(last)).not.toContain("unmatched_menu_items");
    expect(formatLastSyncLine(last)).toContain("3,815 orders");
    expect(formatLastSyncLine(last)).toContain("20,089 rows saved");
    expect(formatLastSyncLine(last)).toContain("1 Jul 2026 – 31 Jul 2026");
  });
});

describe("safeSyncErrorMessage", () => {
  it("maps known error codes and never surfaces raw Odoo fault text", () => {
    const fault =
      "Access Denied: Access to pos.order denied for uid 5 <Fault 1: 'traceback'>";
    expect(
      safeSyncErrorMessage(409, { error: "odoo_location_mapping_required" })
    ).toMatch(/Map every selected Odoo company/);
    expect(
      safeSyncErrorMessage(502, {
        error: "Failed to fetch Odoo POS orders",
        details: "Odoo request failed (unknown)",
        message: fault,
      })
    ).toBe("Could not reach Odoo. Try again in a few minutes.");
    expect(
      safeSyncErrorMessage(400, {
        error: `Requested range spans 120 days; the manual sync is capped at 92 days per call`,
      })
    ).toMatch(/92 days/);
    expect(safeSyncErrorMessage(401, { error: fault })).toBe(
      "Could not sign in to Odoo. Check the connection and API key."
    );
    expect(safeSyncErrorMessage(0, {})).toMatch(/Network error/);

    const mapped = safeSyncErrorMessage(500, {
      error: fault,
      details: fault,
      message: fault,
    });
    expect(mapped).not.toContain("Access Denied");
    expect(mapped).not.toContain("uid 5");
    expect(mapped).not.toContain("traceback");
    expect(mapped).not.toContain("Fault");
  });
});
