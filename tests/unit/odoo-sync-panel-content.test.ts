import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Odoo Sync now panel", () => {
  const panel = read("components/management/odoo-sync-panel.tsx");
  const page = read("app/management/odoo/page.tsx");
  const route =
    read("app/api/restaurant/pos/odoo-sync/route.ts") +
    read("lib/restaurant/odoo/sync-company.ts");
  const companies = read("app/api/admin/companies/route.ts");

  it("is mounted on the admin Odoo page", () => {
    expect(page).toContain("OdooSyncPanel");
    expect(page).toContain("@/components/management/odoo-sync-panel");
  });

  it("calls the existing sync endpoint and guards double-submit", () => {
    expect(panel).toContain('fetch("/api/restaurant/pos/odoo-sync"');
    expect(panel).toContain("createInFlightGuard");
    expect(panel).toContain(
      "disabled={syncing || !canSync || !startDate || !endDate}"
    );
    expect(panel).toContain("if (!canSync) return");
    expect(panel).toContain("o.syncNow");
    expect(read("lib/i18n/es/admin.ts")).toContain("Sincronizar ahora");
    expect(read("lib/i18n/de/admin.ts")).toContain("Jetzt synchronisieren");
    expect(panel).toContain("MAX_RANGE_DAYS");
  });

  it("names the signed-in workspace and disables Sync now for another company", () => {
    expect(panel).toContain("syncWorkspaceCopy");
    expect(panel).toContain("formatWorkspaceLastSyncLine");
    expect(panel).toContain("odoo-sync-target");
    expect(page).toContain("canSyncSelectedWorkspace");
    expect(page).toContain("findOwnCompany");
    expect(page).toContain("ownCompanyName");
    expect(page).toContain("canSync={canSync}");
  });

  it("raises the sync route duration so a ~20k-row month does not 504 without JSON", () => {
    expect(route).toContain("export const maxDuration = 300");
  });

  it("labels the signed-in workspace on the companies list", () => {
    expect(companies).toContain("resolveCompanyIdForUser");
    expect(companies).toContain("is_own");
  });

  it("renders the human summary helpers instead of raw JSON", () => {
    expect(panel).toContain("summarizeOdooSync");
    expect(panel).toContain("syncSummaryCopy");
    expect(panel).toContain("safeSyncErrorMessageForLang");
    expect(panel).toContain("unmatchedTillsNote");
    expect(panel).not.toContain("data.details");
    expect(panel).not.toContain("err.message");
    expect(panel).not.toContain("body.details");
  });

  it("the sync route stays admin-only and persists a compact last_sync", () => {
    expect(route).toContain('requireCapability(actor, "odoo.sync")');
    expect(route).toContain("persistLastSync");
    expect(route).toContain("compactLastSync");
    const adminAt = route.indexOf('requireCapability(actor, "odoo.sync")');
    const secretAt = route.indexOf("loadDecryptedOdooSecret(conn.id");
    expect(adminAt).toBeGreaterThan(-1);
    expect(secretAt).toBeGreaterThan(-1);
    expect(adminAt).toBeLessThan(secretAt);
  });

  it("has no English UI string left in the panel or the Spanish sync summary", async () => {
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const english =
      /\b(Sync now|Syncing|Show list|Show reasons|Quick range|Start date|End date|Warnings|Sales updated|Fetched|orders|rows|were skipped|did not match|menu items?|till names?|Last synced|Yesterday|Last 7 days|This month|Last month)\b/;
    expect(strip(panel), "panel").not.toMatch(english);
    // The helpers hold es / en / de side by side (t(lang, en, es, de)): what
    // Spanish gets by default is what must be Spanish.
    const { summarizeOdooSync, syncSummaryCopy, formatLastSyncLine } =
      await import("@/lib/restaurant/odoo/sync-summary");
    const { syncWorkspaceCopy, formatWorkspaceLastSyncLine } =
      await import("@/lib/restaurant/odoo/sync-workspace");
    const { SYNC_DATE_PRESETS, syncPresetLabel } =
      await import("@/lib/restaurant/odoo/sync-control");
    const view = summarizeOdooSync({
      synced_range: { start_date: "2026-03-01", end_date: "2026-03-07" },
      orders_fetched: 3,
      rows_upserted: 5,
      lines_skipped: [{ reason: "Order not in a completed state" }],
      unmatched_menu_items: ["a"],
      unmatched_locations: ["b"],
      rows_outside_requested_range_excluded: 2,
    });
    const last = {
      synced_at: "2026-03-08T10:00:00Z",
      start_date: "2026-03-01",
      end_date: "2026-03-07",
      orders_fetched: 3,
      rows_upserted: 5,
      skipped_count: 1,
      unmatched_menu_item_count: 1,
      unmatched_locations: [],
      warning_count: 0,
    };
    const text = JSON.stringify([
      syncSummaryCopy(view),
      view.skippedGroups,
      formatLastSyncLine(last),
      syncWorkspaceCopy({
        canSync: false,
        ownCompanyName: null,
        selectedCompanyName: null,
      }),
      formatWorkspaceLastSyncLine(null, null, true),
      formatWorkspaceLastSyncLine(last, null, true),
      SYNC_DATE_PRESETS.map((p) => syncPresetLabel(p.id)),
    ]);
    expect(text).not.toMatch(english);
    expect(text).toMatch(/pedidos/);
  });

  it("the Odoo sync summary speaks German with Sie", async () => {
    const { syncSummaryCopy, summarizeOdooSync } =
      await import("@/lib/restaurant/odoo/sync-summary");
    const view = summarizeOdooSync(
      {
        synced_range: { start_date: "2026-03-01", end_date: "2026-03-07" },
        orders_fetched: 1234,
        rows_upserted: 5,
      },
      "de"
    );
    const copy = syncSummaryCopy(view, "de");
    expect(copy.headline).toContain("1.234 Bestellungen");
    expect(copy.skipped).toBe("Es wurde keine Zeile übersprungen.");
  });

  it("«Ver lista» is a visible blue button, not a ghost link", () => {
    expect(panel).toContain("o.viewList");
    expect(read("lib/i18n/es/admin.ts")).toContain("Ver lista");
    expect(panel).toContain("border-[#1B40C8]");
    expect(panel).not.toContain('variant="ghost"');
  });
});
