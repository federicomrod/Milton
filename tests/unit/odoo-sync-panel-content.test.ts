import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Odoo Sync now panel", () => {
  const panel = read("components/management/odoo-sync-panel.tsx");
  const page = read("app/management/odoo/page.tsx");
  const route = read("app/api/restaurant/pos/odoo-sync/route.ts");

  it("is mounted on the admin Odoo page", () => {
    expect(page).toContain("OdooSyncPanel");
    expect(page).toContain("@/components/management/odoo-sync-panel");
  });

  it("calls the existing sync endpoint and guards double-submit", () => {
    expect(panel).toContain('fetch("/api/restaurant/pos/odoo-sync"');
    expect(panel).toContain("createInFlightGuard");
    expect(panel).toContain("disabled={syncing || !startDate || !endDate}");
    expect(panel).toContain("Sync now");
    expect(panel).toContain("MAX_RANGE_DAYS");
  });

  it("renders the human summary helpers instead of raw JSON", () => {
    expect(panel).toContain("summarizeOdooSync");
    expect(panel).toContain("syncSummaryCopy");
    expect(panel).toContain("safeSyncErrorMessage");
    expect(panel).toContain("unmatchedTillsNote");
    expect(panel).not.toContain("data.details");
    expect(panel).not.toContain("err.message");
    expect(panel).not.toContain("body.details");
  });

  it("the sync route stays admin-only and persists a compact last_sync", () => {
    expect(route).toContain("isUserAdminServer");
    expect(route).toContain("persistLastSync");
    expect(route).toContain("compactLastSync");
    const adminAt = route.indexOf("isUserAdminServer(userId)");
    const secretAt = route.indexOf("loadDecryptedOdooSecret(conn.id");
    expect(adminAt).toBeGreaterThan(-1);
    expect(secretAt).toBeGreaterThan(-1);
    expect(adminAt).toBeLessThan(secretAt);
  });
});
