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
    expect(panel).toContain("Sincronizar ahora");
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

  it("has no English UI string left in the panel or the sync summary", () => {
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const english =
      /\b(Sync now|Syncing|Show list|Show reasons|Quick range|Start date|End date|Warnings|Sales updated|Fetched|orders|rows|were skipped|did not match|menu items?|till names?|Last synced|Yesterday|Last 7 days|This month|Last month)\b/;
    for (const file of [
      "components/management/odoo-sync-panel.tsx",
      "lib/restaurant/odoo/sync-summary.ts",
      "lib/restaurant/odoo/sync-workspace.ts",
      "lib/restaurant/odoo/sync-control.ts",
    ]) {
      expect(strip(read(file)), file).not.toMatch(english);
    }
  });

  it("«Ver lista» is a visible blue button, not a ghost link", () => {
    expect(panel).toContain("Ver lista");
    expect(panel).toContain("border-[#1B40C8]");
    expect(panel).not.toContain('variant="ghost"');
  });
});
