import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  syncButtonDisabled,
  syncButtonVisibility,
} from "@/lib/restaurant/sync-visibility";

describe("header Sync button visibility (#128)", () => {
  it("enables Sync for Milton admins", () => {
    expect(syncButtonVisibility(true)).toBe("enabled");
    expect(syncButtonDisabled(true)).toBe(false);
  });

  it("disables Sync for non-admins instead of erroring", () => {
    expect(syncButtonVisibility(false)).toBe("disabled");
    expect(syncButtonDisabled(false)).toBe(true);
  });

  it("the header button uses the visibility helper and a tooltip for non-admins", () => {
    const src = readFileSync(
      join(process.cwd(), "components/restaurant/shell/SyncNowButton.tsx"),
      "utf8"
    );
    expect(src).toContain("syncButtonDisabled");
    expect(src).toContain('fetch("/api/restaurant/pos/odoo-sync"');
    expect(src).toContain("createInFlightGuard");
    expect(src).toContain("Only Milton admins can sync POS data.");
    expect(src).toContain("Tooltip");
    expect(src).not.toContain("throw");
  });
});
