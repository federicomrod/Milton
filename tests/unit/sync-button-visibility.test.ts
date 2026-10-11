import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  syncButtonHidden,
  syncButtonVisibility,
} from "@/lib/restaurant/sync-visibility";
import { isDataSettingsLinkListed } from "@/lib/restaurant/navigation";

describe("header Sync button visibility (#128)", () => {
  it("shows Sync for Milton admins", () => {
    expect(syncButtonVisibility(true)).toBe("shown");
    expect(syncButtonHidden(true)).toBe(false);
  });

  it("hides Sync for non-admins instead of showing a disabled button", () => {
    expect(syncButtonVisibility(false)).toBe("hidden");
    expect(syncButtonHidden(false)).toBe(true);
    const src = readFileSync(
      join(process.cwd(), "components/restaurant/shell/SyncNowButton.tsx"),
      "utf8"
    );
    expect(src).toContain("syncButtonHidden");
    expect(src).toContain("return null");
    expect(src).toContain("sync-confirm-popover");
    expect(src).toContain("defaultSyncWindow");
    expect(src).not.toContain("parsePageDateRange");
  });
});

describe("Invitaciones admin gating", () => {
  it("lists Invitaciones only for admins", () => {
    expect(isDataSettingsLinkListed("invitations", { isAdmin: true })).toBe(
      true
    );
    expect(isDataSettingsLinkListed("invitations", { isAdmin: false })).toBe(
      false
    );
  });

  it("hides the duplicate Menu and dead Metas links from Data & Settings", () => {
    expect(isDataSettingsLinkListed("menu-recipes", { isAdmin: true })).toBe(
      false
    );
    expect(isDataSettingsLinkListed("targets", { isAdmin: true })).toBe(false);
  });
});
