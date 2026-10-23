import { describe, it, expect, vi, beforeEach } from "vitest";

// Invented data only. The shared sync function and the admin client are
// mocked; what is proven here is auth, per-company timezone dates,
// failure isolation and the skip rules.

const syncSpy = vi.fn();
const SECRET = "test-cron-secret";

type Conn = { company_id: string; timezone: string | null };

function adminWith(connections: Conn[], rowsByCompany?: Map<string, Conn>) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "restaurant_pos_connections") {
        throw new Error(`unexpected table ${table}`);
      }
      let companyFilter: string | null = null;
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn((col: string, val: string) => {
        if (col === "company_id") companyFilter = val;
        return q;
      });
      q.limit = vi.fn(() => q);
      q.maybeSingle = vi.fn(async () => ({
        data: connections.find((c) => c.company_id === companyFilter) ?? null,
        error: null,
      }));
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: connections, error: null }).then(res);
      void rowsByCompany;
      return q;
    }),
  };
}

async function load(connections: Conn[]) {
  vi.resetModules();
  syncSpy.mockReset();
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => adminWith(connections),
  }));
  vi.doMock("@/lib/restaurant/odoo/sync-company", () => ({
    syncOdooCompany: syncSpy,
  }));
  return import("@/app/api/cron/odoo-sync/route");
}

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/odoo-sync", {
    headers: auth ? { authorization: auth } : {},
  });

describe("GET /api/cron/odoo-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    vi.useRealTimers();
  });

  it("rejects missing and wrong secrets with 401 and never syncs", async () => {
    const { GET } = await load([
      { company_id: "co-aaa", timezone: "America/El_Salvador" },
    ]);
    expect((await GET(req() as never)).status).toBe(401);
    expect((await GET(req("Bearer nope") as never)).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req(`Bearer ${SECRET}`) as never)).status).toBe(401);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("syncs yesterday and today in each company's local timezone", async () => {
    // 2026-03-10 03:30 UTC = 2026-03-09 21:30 in El Salvador (UTC-6)
    // and 2026-03-10 12:30 in Auckland... pick a zone ahead of UTC too.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T03:30:00Z"));
    const { GET } = await load([
      { company_id: "co-sv", timezone: "America/El_Salvador" },
      { company_id: "co-nz", timezone: "Pacific/Auckland" },
    ]);
    syncSpy.mockResolvedValue({ status: 200, body: { rows_upserted: 4 } });
    const res = await GET(req(`Bearer ${SECRET}`) as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    const calls = Object.fromEntries(
      syncSpy.mock.calls.map(([p]) => [p.companyId, p])
    );
    expect(calls["co-sv"].start_date).toBe("2026-03-08");
    expect(calls["co-sv"].end_date).toBe("2026-03-09");
    expect(calls["co-nz"].start_date).toBe("2026-03-09");
    expect(calls["co-nz"].end_date).toBe("2026-03-10");
    expect(json).toMatchObject({ companies: 2, ok: 2, failed: 0 });
    expect(JSON.stringify(json)).not.toContain("co-sv");
  });

  it("one failing company does not stop the others", async () => {
    const { GET } = await load([
      { company_id: "co-1", timezone: "UTC" },
      { company_id: "co-2", timezone: "UTC" },
      { company_id: "co-3", timezone: "UTC" },
    ]);
    syncSpy.mockImplementation(async ({ companyId }) => {
      if (companyId === "co-1") throw new Error("https://x.test?token=abc");
      if (companyId === "co-2") {
        return {
          status: 409,
          body: { error: "odoo_location_mapping_required" },
        };
      }
      return { status: 200, body: { rows_upserted: 7 } };
    });
    const res = await GET(req(`Bearer ${SECRET}`) as never);
    const json = await res.json();
    expect(syncSpy).toHaveBeenCalledTimes(3);
    expect(json).toMatchObject({ companies: 3, ok: 1, failed: 2 });
    const kinds = json.results.map(
      (r: { error_kind?: string }) => r.error_kind
    );
    expect(kinds).toContain("odoo_location_mapping_required");
    expect(JSON.stringify(json)).not.toContain("token=abc");
    expect(
      json.results.find((r: { rows?: number }) => r.rows === 7)
    ).toBeTruthy();
  });

  it("skips nothing-to-do: no active connections means no sync", async () => {
    const { GET } = await load([]);
    const json = await (await GET(req(`Bearer ${SECRET}`) as never)).json();
    expect(json).toMatchObject({ companies: 0, ok: 0, failed: 0 });
    expect(syncSpy).not.toHaveBeenCalled();
  });
});

describe("autoSyncOdooCompany", () => {
  it("skips a company without an active connection and never calls Odoo", async () => {
    await load([]);
    const mod = await import("@/lib/restaurant/odoo/auto-sync");
    const r = await mod.autoSyncOdooCompany(
      adminWith([]) as never,
      "co-none",
      new Date()
    );
    expect(r).toMatchObject({ ok: true, skipped: true });
    expect(syncSpy).not.toHaveBeenCalled();
  });
});

describe("syncOdooCompany regression (extracted from the manual route)", () => {
  it("returns the same 404 body the route always returned when no connection exists", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/restaurant/odoo/sync-company");
    const { syncOdooCompany } =
      await import("@/lib/restaurant/odoo/sync-company");
    const out = await syncOdooCompany({
      supabase: adminWith([]) as never,
      companyId: "co-x",
      start_date: "2026-01-01",
      end_date: "2026-01-02",
    });
    expect(out.status).toBe(404);
    expect(out.body.error).toBe(
      "No active Odoo connection configured for this company"
    );
  });
});

describe("briefing cron runs the sync first and never blocks on it", () => {
  const { readFileSync } = require("fs") as typeof import("fs");
  const src = readFileSync("app/api/cron/briefing-email/route.ts", "utf8");
  it("calls autoSyncOdooCompany before generateBriefing", () => {
    const a = src.indexOf("await autoSyncOdooCompany(");
    const b = src.indexOf("await generateBriefing(");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  it("a failed sync only logs; the briefing continues", () => {
    const block = src.slice(
      src.indexOf("await autoSyncOdooCompany("),
      src.indexOf("await generateBriefing(")
    );
    expect(block).toContain("console.error");
    expect(block).not.toMatch(/continue|return|throw/);
  });
});
