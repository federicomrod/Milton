// R1-17a: migration 054 (shifts + business day) in an in-memory Postgres.
// Synthetic data only. The column types are the real ones (sale_date is a date).
import { readFileSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { dailyFromRows } from "@/lib/restaurant/cockpit-daily";
import { dayProductsFromRows } from "@/lib/restaurant/cockpit-cost-days";

const MIG = join(process.cwd(), "supabase/migrations");
const C = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const L1 = "a1111111-1111-4111-8111-111111111111";
const L2 = "a2222222-2222-4222-8222-222222222222";
const TZ = "America/El_Salvador"; // UTC-6, no DST

let db: PGlite;

function slice(file: string, from: string, to?: string) {
  const s = readFileSync(join(MIG, file), "utf8");
  const a = s.indexOf(from);
  const b = to
    ? s.indexOf(to, a)
    : s.indexOf("$$;", s.indexOf("$$", a) + 2) + 3;
  return s.slice(a, b);
}

async function line(o: {
  c?: string;
  l?: string;
  date: string;
  at: string | null; // local clock "YYYY-MM-DD HH:MM" (UTC-6)
  net: number;
  qty?: number;
  order: string;
  cat?: string;
  tip?: boolean;
}) {
  const utc = o.at
    ? new Date(o.at.replace(" ", "T") + ":00-06:00").toISOString()
    : null;
  await db.query(
    `INSERT INTO pos_sales_items (company_id, location_id, sale_date, order_placed_at, raw_item_name, quantity, gross_revenue, currency, category, is_tip, check_id, sales_channel, payment_type, source_metadata)
     VALUES ($1,$2,$3,$4,'x',$5,$6,'USD',$7,$8,$9,'Eat In','Efectivo',NULL)`,
    [
      o.c ?? C,
      o.l ?? L1,
      o.date,
      utc,
      o.qty ?? 1,
      o.net,
      o.cat ?? "Platos",
      o.tip ?? false,
      o.order,
    ]
  );
}

const asMember = (company: string) =>
  db.exec(
    `CREATE OR REPLACE FUNCTION public.is_company_member(c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT c = '${company}'::uuid $$;`
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN others THEN NULL; END $$;
    CREATE TABLE public.companies (id uuid PRIMARY KEY);
    CREATE TABLE public.restaurant_locations (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), name text);
    CREATE TABLE public.pos_sales_items (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid NOT NULL, location_id uuid,
      sale_date date NOT NULL, order_placed_at timestamptz, raw_item_name text, quantity numeric,
      gross_revenue numeric, net_revenue numeric, discount_amount numeric, currency text, category text,
      is_tip boolean, source_metadata jsonb, check_id text, order_id text, sales_channel text, payment_type text);
    INSERT INTO public.companies VALUES ('${C}'), ('${C2}');
    INSERT INTO public.restaurant_locations VALUES ('${L1}','${C}','Uno'), ('${L2}','${C}','Dos');
  `);
  await asMember(C);
  await db.exec(
    slice(
      "031_cockpit_pos_rollup.sql",
      "CREATE OR REPLACE FUNCTION public.pos_line_is_tip("
    )
  );
  await db.exec(
    slice(
      "046_pos_product_sales_rollup.sql",
      "CREATE OR REPLACE FUNCTION public.pos_odoo_product_id(",
      "CREATE OR REPLACE FUNCTION public.pos_product_sales_groups("
    )
  );
  const sql = readFileSync(join(MIG, "054_restaurant_shifts.sql"), "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 120_000);

const q = async <T = any>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const period = async (
  loc: string | null = null,
  from = "2026-07-01",
  to = "2026-07-31"
) =>
  (
    await q(
      `SELECT public.sales_period_rollup($1::uuid,$2::uuid,$3,'USD',$4::date,$5::date) r`,
      [C, loc, TZ, from, to]
    )
  )[0].r;

describe("shifts table and seed", () => {
  it("seeds every restaurant with today's split, once", async () => {
    const rows = await q(
      `SELECT restaurant_id, name, start_time::text s, end_time::text e FROM restaurant_shifts ORDER BY restaurant_id, sort_order`
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.restaurant_id === L1)).toEqual([
      { restaurant_id: L1, name: "Almuerzo", s: "00:00:00", e: "17:00:00" },
      { restaurant_id: L1, name: "Cena", s: "17:00:00", e: "24:00:00" },
    ]);
  });
  it("closed to anon; a non-member gets 42501", async () => {
    const anon = await q(
      `SELECT has_function_privilege('anon','public.restaurant_shifts_save(uuid,uuid,jsonb)','execute') a,
              has_function_privilege('anon','public.sales_period_rollup(uuid,uuid,text,text,date,date)','execute') b,
              has_table_privilege('anon','public.restaurant_shifts','select') c`
    );
    expect(anon[0]).toEqual({ a: false, b: false, c: false });
    await asMember(C2);
    await expect(
      q(`SELECT public.restaurant_shifts_save($1::uuid,$2::uuid,'[]'::jsonb)`, [
        C,
        L1,
      ])
    ).rejects.toMatchObject({ code: "42501" });
    await asMember(C);
  });
});

describe("restaurant_shifts_save", () => {
  const save = (restaurant: string, shifts: unknown, company = C) =>
    q(`SELECT public.restaurant_shifts_save($1::uuid,$2::uuid,$3::jsonb) r`, [
      company,
      restaurant,
      JSON.stringify(shifts),
    ]);
  const all = { weekdays: [1, 2, 3, 4, 5, 6, 7], active: true };
  it("T4: overlapping active shifts are rejected (22023, Spanish), including across midnight", async () => {
    await expect(
      save(L2, [
        { name: "Almuerzo", start_time: "11:00", end_time: "17:00", ...all },
        { name: "Cena", start_time: "16:00", end_time: "23:00", ...all },
      ])
    ).rejects.toMatchObject({
      code: "22023",
      message: expect.stringContaining("se solapan el mismo día"),
    });
    // 18:00–02:00 against the seeded 00:00–17:00: overlap after midnight.
    await expect(
      save(L2, [
        { name: "Almuerzo", start_time: "00:00", end_time: "17:00", ...all },
        { name: "Cena", start_time: "18:00", end_time: "02:00", ...all },
      ])
    ).rejects.toMatchObject({ code: "22023" });
  });
  it("different weekdays or an inactive shift do not overlap", async () => {
    await save(L2, [
      {
        name: "A",
        start_time: "11:00",
        end_time: "17:00",
        weekdays: [1, 2, 3],
        active: true,
      },
      {
        name: "B",
        start_time: "12:00",
        end_time: "18:00",
        weekdays: [5, 6],
        active: true,
      },
      {
        name: "C",
        start_time: "12:00",
        end_time: "18:00",
        weekdays: [1, 2, 3],
        active: false,
      },
    ]);
    expect(
      await q(
        `SELECT count(*)::int n FROM restaurant_shifts WHERE restaurant_id=$1`,
        [L2]
      )
    ).toEqual([{ n: 3 }]);
  });
  it("rejects a restaurant of another company, bad times and bad names", async () => {
    await expect(
      save("a9999999-9999-4999-8999-999999999999", [])
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      save(L1, [{ name: "X", start_time: "10:00", end_time: "10:00", ...all }])
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      save(L1, [{ name: "  ", start_time: "10:00", end_time: "11:00", ...all }])
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      save(L1, [{ name: "X", start_time: "xx", end_time: "11:00", ...all }])
    ).rejects.toMatchObject({ code: "22023" });
  });
  it("a failed save changes nothing", async () => {
    const before = await q(
      `SELECT name FROM restaurant_shifts WHERE restaurant_id=$1 ORDER BY sort_order`,
      [L1]
    );
    await expect(
      save(L1, [{ name: "Z", start_time: "10:00", end_time: "10:00", ...all }])
    ).rejects.toBeTruthy();
    expect(
      await q(
        `SELECT name FROM restaurant_shifts WHERE restaurant_id=$1 ORDER BY sort_order`,
        [L1]
      )
    ).toEqual(before);
  });
  it("the cutoff is the end of the last shift that crosses midnight, else 04:00", async () => {
    const cut = async (l: string) =>
      (
        await q(
          `SELECT public.restaurant_business_day_cutoff($1::uuid)::text c`,
          [l]
        )
      )[0].c;
    expect(await cut(L1)).toBe("04:00:00"); // seeded: nothing crosses midnight
    await save(L2, [
      { name: "Almuerzo", start_time: "11:00", end_time: "17:00", ...all },
      { name: "Cena", start_time: "18:00", end_time: "02:00", ...all },
    ]);
    expect(await cut(L2)).toBe("02:00:00");
    // a "crossing" shift that ends at 11:00 is unclear: default
    await save(L2, [
      { name: "Raro", start_time: "20:00", end_time: "11:00", ...all },
    ]);
    expect(await cut(L2)).toBe("04:00:00");
    await save(L2, [
      { name: "Almuerzo", start_time: "11:00", end_time: "17:00", ...all },
      { name: "Cena", start_time: "18:00", end_time: "02:00", ...all },
    ]);
  });
});

describe("the business day in the rollups", () => {
  beforeAll(async () => {
    // L1 (default 04:00): Fri 2026-07-03 evening and a 01:30 order on the 4th.
    await line({
      date: "2026-07-03",
      at: "2026-07-03 12:30",
      net: 40,
      order: "a1",
    });
    await line({
      date: "2026-07-03",
      at: "2026-07-03 19:00",
      net: 60,
      order: "a2",
    });
    await line({
      date: "2026-07-04",
      at: "2026-07-04 01:30",
      net: 25,
      order: "a3",
    }); // belongs to the 3rd
    await line({
      date: "2026-07-04",
      at: "2026-07-04 04:30",
      net: 10,
      order: "a4",
    }); // 4th
    await line({
      date: "2026-07-04",
      at: "2026-07-04 12:00",
      net: 5,
      order: "a5",
      tip: true,
    });
    // L2 (Cena 18:00–02:00, cutoff 02:00): 01:30 in Cena and on the previous day;
    // 02:30 is a new day and outside every shift.
    await line({
      l: L2,
      date: "2026-07-03",
      at: "2026-07-03 12:00",
      net: 30,
      order: "b1",
    });
    await line({
      l: L2,
      date: "2026-07-03",
      at: "2026-07-03 20:00",
      net: 70,
      order: "b2",
    });
    await line({
      l: L2,
      date: "2026-07-04",
      at: "2026-07-04 01:30",
      net: 15,
      order: "b3",
    });
    await line({
      l: L2,
      date: "2026-07-04",
      at: "2026-07-04 02:30",
      net: 8,
      order: "b4",
    });
    // A line of another company never shows; one with no timestamp keeps its date.
    await line({
      c: C2,
      date: "2026-07-03",
      at: "2026-07-03 12:00",
      net: 999,
      order: "z1",
    });
    await line({ date: "2026-07-05", at: null, net: 3, order: "a6" });
  });
  const daily = async (loc: string | null) =>
    Object.fromEntries(
      (await period(loc)).daily.map((d: any) => [d.date, d.net_sales])
    );

  it("post-midnight sales count toward the previous business day (cutoff per restaurant)", async () => {
    expect(await daily(L1)).toEqual({
      "2026-07-03": 125,
      "2026-07-04": 10,
      "2026-07-05": 3,
    });
    expect(await daily(L2)).toEqual({ "2026-07-03": 115, "2026-07-04": 8 });
    expect(await daily(null)).toEqual({
      "2026-07-03": 240,
      "2026-07-04": 18,
      "2026-07-05": 3,
    });
  });
  it("the three rollups agree on the daily series", async () => {
    const cp = (
      await q(`SELECT public.cockpit_pos_rollup($1::uuid,NULL,$2,'USD') r`, [
        C,
        TZ,
      ])
    )[0].r;
    const dp = (
      await q(
        `SELECT public.cockpit_product_day_rollup($1::uuid,NULL,$2,'USD') r`,
        [C, TZ]
      )
    )[0].r;
    const byDay = (xs: any[], k: string, v: string) => {
      const m: Record<string, number> = {};
      for (const x of xs)
        m[x[k]] = Math.round(((m[x[k]] ?? 0) + Number(x[v])) * 100) / 100;
      return m;
    };
    const fromCockpit = byDay(cp.daily, "date", "net_sales");
    expect(fromCockpit).toEqual(await daily(null));
    expect(byDay(dp, "d", "n")).toEqual(fromCockpit);
  });
  it("the app's row walk gives the same days as the SQL (one definition of the business day)", async () => {
    const raw = await q(
      `SELECT sale_date::text AS sale_date, to_char(order_placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS order_placed_at, location_id, gross_revenue::float AS gross_revenue,
              quantity::float AS quantity, check_id, is_tip, currency, category
       FROM pos_sales_items WHERE company_id = $1`,
      [C]
    );
    const cutoff: Record<string, number> = { [L1]: 240, [L2]: 120 };
    const rows = raw.map((r: any) => ({
      ...r,
      business_cutoff_min: cutoff[r.location_id],
    }));
    const app = Object.fromEntries(
      dailyFromRows(rows as never, TZ, "USD").map((d) => [d.date, d.net_sales])
    );
    expect(app).toEqual(await daily(null));
    const products = dayProductsFromRows(rows as never, TZ, "USD");
    const byDay: Record<string, number> = {};
    for (const p of products)
      byDay[p.date] = Math.round(((byDay[p.date] ?? 0) + p.net) * 100) / 100;
    expect(byDay).toEqual(await daily(null));
  });
  it("T1/T5: shifts follow the clock; shifts + «Otro horario» = Ventas netas", async () => {
    const p1 = await period(L1);
    const s1 = Object.fromEntries(
      p1.shifts.map((s: any) => [s.name, s.net_sales])
    );
    // seeded split == the old hour < 17 split (01:30 and 04:30 are Almuerzo, like before)
    expect(s1).toEqual({ Almuerzo: 40 + 25 + 10, Cena: 60 });
    expect(p1.lunch.net_sales).toBe(75);
    expect(p1.dinner.net_sales).toBe(60);
    const p2 = await period(L2);
    const s2 = Object.fromEntries(
      p2.shifts.map((s: any) => [s.name, s.net_sales])
    );
    // T3: the 01:30 order is in Cena (18:00–02:00) and on the previous business day; 02:30 is "Otro horario"
    expect(s2).toEqual({ Almuerzo: 30, Cena: 70 + 15, "Otro horario": 8 });
    for (const p of [p1, p2]) {
      const sum = p.shifts.reduce((a: number, s: any) => a + s.net_sales, 0);
      expect(Math.round(sum * 100) / 100).toBe(
        p.revenue.net_sales - (p === p1 ? 3 : 0)
      ); // the line with no timestamp has no shift
    }
  });
  it("heatmap hours stay clock hours; their weekday is the business weekday", async () => {
    const cells = (await period(L1)).heatmap_cells as any[];
    // 2026-07-03 is a Friday (DOW 5): the 01:30 order sits at hour 1 of FRIDAY
    expect(cells.find((c) => c.hour === 1)).toMatchObject({
      weekday: 5,
      net_sales: 25,
    });
    expect(cells.find((c) => c.hour === 4)).toMatchObject({
      weekday: 6,
      net_sales: 10,
    });
  });
  it("a non-member gets 42501 from the rollups, never an empty answer", async () => {
    await asMember(C2);
    await expect(period(null)).rejects.toMatchObject({ code: "42501" });
    await asMember(C);
  });
});
