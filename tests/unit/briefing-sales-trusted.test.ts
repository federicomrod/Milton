// The automatic briefing runs with the service role (no auth.uid()), so the
// member-gated sales RPCs answer "no sales". The trusted read walks
// pos_sales_items directly, always scoped by company_id. Fake ids and names only.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { makeFakeDb, type FakeStore, type Row } from "./helpers/fake-db";
import {
  BRIEFING_TRUSTED_READ_DAYS,
  loadDailySales,
} from "@/lib/restaurant/briefing-context";
import { computeBriefingSalesPeriods } from "@/lib/restaurant/briefing-periods";
import { dailyFromRows } from "@/lib/restaurant/cockpit-daily";

const CO = "co-demo-1";
const OTHER = "co-demo-2";
const LOC_A = "loc-a";
const LOC_B = "loc-b";
const TZ = "America/El_Salvador";
// Sun 25 Oct 2026, 13:23 UTC = 07:23 in El Salvador → yesterday = 24 Oct.
const NOW = new Date("2026-10-25T13:23:00Z");

function sale(
  company: string,
  location: string,
  day: string,
  net: number,
  check: string,
  placedAt?: string
): Row {
  return {
    id: `${company}-${location}-${day}-${check}`,
    company_id: company,
    location_id: location,
    sale_date: day,
    order_id: check,
    check_id: check,
    raw_item_name: "Plato demo",
    quantity: 1,
    gross_revenue: net,
    net_revenue: net,
    discount_amount: 0,
    currency: "USD",
    sales_channel: null,
    payment_type: null,
    category: null,
    sub_category: null,
    order_placed_at: placedAt ?? `${day}T18:00:00Z`,
    is_tip: false,
    source_metadata: null,
    menu_item_id: null,
  };
}

function buildStore(): FakeStore {
  const rows: Row[] = [];
  // two locations of ONE company: 18..24 Oct, 100 + 50 each day, one check each
  for (let d = 18; d <= 24; d++) {
    const day = `2026-10-${d}`;
    rows.push(sale(CO, LOC_A, day, 100, `a-${d}`));
    rows.push(sale(CO, LOC_B, day, 50, `b-${d}`));
  }
  // 23:30 local on the 24th = 05:30 UTC on the 25th: still the 24th
  rows.push(
    sale(CO, LOC_A, "2026-10-24", 30, "late-24", "2026-10-25T05:30:00Z")
  );
  // another company, same days: must never be counted
  for (let d = 18; d <= 24; d++) {
    rows.push(sale(OTHER, "loc-x", `2026-10-${d}`, 9999, `x-${d}`));
  }
  // older than the trusted window: not read
  rows.push(sale(CO, LOC_A, "2026-08-01", 7777, "old-1"));
  return {
    pos_sales_items: rows,
    restaurant_locations: [],
    companies: [{ id: CO, briefing_email_timezone: TZ }],
  } as FakeStore;
}

/** The empty payload cockpit_pos_rollup answers to a caller that is not a member. */
const NON_MEMBER_PAYLOAD = {
  row_count: 0,
  daily: [],
  revenue: { net_sales: 0 },
  tickets: 0,
  units: 0,
};

interface Seen {
  table: string;
  col: string;
  val: unknown;
}

function client(
  store: FakeStore,
  rpc: (name: string) => Promise<{ data: unknown; error: unknown }>
) {
  const db = makeFakeDb(store);
  const seen: Seen[] = [];
  const tables: string[] = [];
  const rpcCalls: string[] = [];
  const wrap = (table: string, builder: Record<string, unknown>): unknown =>
    new Proxy(builder, {
      get(target, prop) {
        const value = target[prop as string];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (prop === "eq")
            seen.push({ table, col: String(args[0]), val: args[1] });
          const out = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          );
          return out === target ? wrap(table, target) : out;
        };
      },
    });
  return {
    seen,
    tables,
    rpcCalls,
    supabase: {
      from: (table: string) => {
        tables.push(table);
        return wrap(table, db.from(table) as never);
      },
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return rpc(name);
      },
    } as never,
  };
}

const sum = (daily: Array<{ date: string; net_sales: number }>, day: string) =>
  daily.filter((d) => d.date === day).reduce((s, d) => s + d.net_sales, 0);

describe("trusted read (cron, service role)", () => {
  it("the non-member rollup would answer 'no sales'; the trusted read still finds both locations", async () => {
    const c = client(buildStore(), async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    });
    expect(daily).not.toBeNull();
    // 24 Oct: 100 + 50 + the 23:30-local row (30)
    expect(sum(daily!, "2026-10-24")).toBe(180);
    // the other company's 9999 never appears; nothing older than the window
    expect(daily!.some((d) => d.net_sales >= 9000)).toBe(false);
    expect(daily!.some((d) => d.date === "2026-08-01")).toBe(false);
    // the member-gated RPC is not even asked
    expect(c.rpcCalls).toEqual([]);
  });

  it("yesterday and the 7-day window use the company timezone (13:23 UTC on 25 Oct → 24 Oct; 18–24 Oct)", async () => {
    const c = client(buildStore(), async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = (await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    }))!;
    const periods = computeBriefingSalesPeriods({
      daily,
      now: NOW,
      timezone: TZ,
      lang: "es",
      formatMoney: (n) => `$${Math.round(n)}`,
    });
    expect(periods.yesterday_date).toBe("2026-10-24");
    expect(periods.yesterday.current.sales).toBe(180);
    // 6 full days of 150 + 180 on the 24th... days 18–23 = 6×150, + 180
    expect(periods.last_7_days.current.sales).toBe(6 * 150 + 180);
    expect(periods.facts.join(" ")).not.toContain(
      "No hay ventas sincronizadas para ayer"
    );
    expect(periods.facts.join(" ")).toContain("18–24 oct");
  });

  it("matches the Cockpit's row walk (dailyFromRows) on the same rows", async () => {
    const store = buildStore();
    const c = client(store, async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = (await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    }))!;
    const mine = (store.pos_sales_items as Row[]).filter(
      (r) => r.company_id === CO && String(r.sale_date) >= "2026-10-08"
    );
    const expected = dailyFromRows(mine as never, TZ, "USD");
    expect(daily).toEqual(expected);
  });

  it("the same holds when the RPC raises 42501", async () => {
    const c = client(buildStore(), async () => ({
      data: null,
      error: { code: "42501", message: "not a member of this company" },
    }));
    const daily = (await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    }))!;
    expect(sum(daily, "2026-10-24")).toBe(180);
  });

  it("every query is scoped to the company (the service role bypasses RLS: this is the only guard), and bounded by date", async () => {
    const c = client(buildStore(), async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    });
    const posReads = c.seen.filter((s) => s.table === "pos_sales_items");
    expect(posReads.length).toBeGreaterThan(0);
    expect(posReads.every((s) => s.col === "company_id" && s.val === CO)).toBe(
      true
    );
    expect(c.tables).toContain("pos_sales_items");
    // the window: 17 local days back from 2026-10-25
    expect(BRIEFING_TRUSTED_READ_DAYS).toBe(17);
  });

  it("a selected restaurant narrows the read to that location (still company-scoped)", async () => {
    const c = client(buildStore(), async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = (await loadDailySales(
      c.supabase,
      CO,
      { locationId: LOC_B } as never,
      TZ,
      "USD",
      { serverTrusted: true, now: NOW }
    ))!;
    expect(sum(daily, "2026-10-24")).toBe(50);
    expect(c.seen.some((s) => s.col === "location_id" && s.val === LOC_B)).toBe(
      true
    );
    expect(
      c.seen.filter((s) => s.col === "company_id").every((s) => s.val === CO)
    ).toBe(true);
  });

  it("no sales rows at all stays empty (never $0 invented)", async () => {
    const store = buildStore();
    store.pos_sales_items = [];
    const c = client(store, async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      serverTrusted: true,
      now: NOW,
    });
    expect(daily).toEqual([]);
    const periods = computeBriefingSalesPeriods({
      daily: daily!,
      now: NOW,
      timezone: TZ,
      lang: "es",
      formatMoney: (n) => `$${n}`,
    });
    expect(periods.facts.join(" ")).toContain(
      "No hay ventas sincronizadas para ayer"
    );
  });
});

describe("defensive fallback for a normal (member) caller", () => {
  it("a rollup with row_count 0 is not final: the row walk runs", async () => {
    const c = client(buildStore(), async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      now: NOW,
    });
    expect(c.rpcCalls).toContain("cockpit_pos_rollup");
    expect(c.tables).toContain("pos_sales_items");
    expect(sum(daily!, "2026-10-24")).toBe(180);
  });

  it("a rollup with rows is used as before (no row walk)", async () => {
    const c = client(buildStore(), async () => ({
      data: {
        row_count: 3,
        daily: [{ date: "2026-10-24", net_sales: 321, tickets: 4 }],
        revenue: { net_sales: 321 },
      },
      error: null,
    }));
    const daily = await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      now: NOW,
    });
    expect(daily).toEqual([
      expect.objectContaining({ date: "2026-10-24", net_sales: 321 }),
    ]);
    expect(c.tables).not.toContain("pos_sales_items");
  });

  it("a real member with no sales gets nothing from the walk either", async () => {
    const store = buildStore();
    store.pos_sales_items = [];
    const c = client(store, async () => ({
      data: NON_MEMBER_PAYLOAD,
      error: null,
    }));
    const daily = await loadDailySales(c.supabase, CO, null, TZ, "USD", {
      now: NOW,
    });
    expect(daily).toEqual([]);
  });
});

describe("serverTrusted is only passed by the cron", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name === ".next") return [];
      return statSync(path).isDirectory()
        ? files(path)
        : /\.(ts|tsx)$/.test(name)
          ? [path]
          : [];
    });

  it("no user-facing route or component sets serverTrusted (send-test, telegram/send-briefing, /api/restaurant/briefing, pages)", () => {
    const users = ["app", "components"]
      .flatMap(files)
      .filter((f) => readFileSync(f, "utf8").includes("serverTrusted"))
      .map((f) => f.split("\\").join("/"));
    expect(users).toEqual(["app/api/cron/briefing-email/route.ts"]);
  });

  it("the three user-facing briefing routes call generateBriefing without it", () => {
    for (const p of [
      "app/api/restaurant/briefing/email/send-test/route.ts",
      "app/api/restaurant/telegram/send-briefing/route.ts",
      "app/api/restaurant/briefing/route.ts",
    ]) {
      expect(readFileSync(p, "utf8"), p).not.toContain("serverTrusted");
    }
  });

  it("outside the briefing job only profitability-server and briefing-context know the option", () => {
    const libs = files("lib")
      .filter((f) => readFileSync(f, "utf8").includes("serverTrusted"))
      .map((f) => f.split("\\").join("/"))
      .sort();
    expect(libs).toEqual([
      "lib/restaurant/briefing-context.ts",
      "lib/restaurant/briefing-generate.ts",
      "lib/restaurant/profitability-server.ts",
    ]);
  });
});

vi.setConfig({ testTimeout: 20000 });
