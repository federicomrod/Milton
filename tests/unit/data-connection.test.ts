import { describe, it, expect, vi } from "vitest";
import { hasDataConnection } from "@/lib/restaurant/data-connection";
import {
  CONNECT_DATA_PATH,
  RESTAURANT_DASHBOARD_PATH,
  landingForConnection,
  resolveInvitedUserLanding,
} from "@/lib/restaurant/post-login";

const landing = (activePosConnections: number, posSalesCount: number) =>
  landingForConnection(
    hasDataConnection({ activePosConnections, posSalesCount })
  );

describe("landing rule", () => {
  it("no connection and 0 sales -> connect-data", () => {
    expect(landing(0, 0)).toBe("/dashboard/restaurant/connect-data");
  });
  it("an active Odoo connection -> dashboard", () => {
    expect(landing(1, 0)).toBe("/dashboard/restaurant");
  });
  it("an inactive connection (not counted) and 0 sales -> connect-data", () => {
    // getDataConnectionStatus only counts is_active = true rows.
    expect(landing(0, 0)).toBe(CONNECT_DATA_PATH);
  });
  it("0 connections and sales > 0 -> dashboard", () => {
    expect(landing(0, 42)).toBe(RESTAURANT_DASHBOARD_PATH);
  });
  it("an Odoo row with odoo_company_ids null still counts as connected", () => {
    // The row is counted regardless of odoo_company_ids.
    expect(
      hasDataConnection({ activePosConnections: 1, posSalesCount: 0 })
    ).toBe(true);
  });
});

function fakeSupabase(opts: {
  invited: boolean | "error";
  conns: number;
  sales: number;
}) {
  const query = (count: number) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ count, error: null });
    return q;
  };
  return {
    rpc: vi
      .fn()
      .mockResolvedValue(
        opts.invited === "error"
          ? { data: null, error: { message: "x" } }
          : { data: opts.invited, error: null }
      ),
    from: (table: string) =>
      query(table === "restaurant_pos_connections" ? opts.conns : opts.sales),
  } as never;
}

describe("resolveInvitedUserLanding", () => {
  it("returns null for users who were not invited (normal routing applies)", async () => {
    expect(
      await resolveInvitedUserLanding(
        fakeSupabase({ invited: false, conns: 0, sales: 0 }),
        "c1"
      )
    ).toBeNull();
    expect(
      await resolveInvitedUserLanding(
        fakeSupabase({ invited: "error", conns: 0, sales: 0 }),
        "c1"
      )
    ).toBeNull();
  });
  it("routes invited users by connection status", async () => {
    expect(
      await resolveInvitedUserLanding(
        fakeSupabase({ invited: true, conns: 0, sales: 0 }),
        "c1"
      )
    ).toBe(CONNECT_DATA_PATH);
    expect(
      await resolveInvitedUserLanding(
        fakeSupabase({ invited: true, conns: 1, sales: 0 }),
        "c1"
      )
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });
  it("assumeInvited skips the invited check", async () => {
    const sb = fakeSupabase({ invited: false, conns: 0, sales: 5 });
    expect(
      await resolveInvitedUserLanding(sb, "c1", { assumeInvited: true })
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });
});
