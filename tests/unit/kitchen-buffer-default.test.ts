// The default kitchen buffer (#405 follow-up): with no row in force, 5% for
// dates on or after BUFFER_DEFAULT_FROM and 0% before; a saved row wins; the
// default is never written as a row. History is append-only (#406): «Solo
// desde hoy» leaves past months as they were, «Aplicar a semanas anteriores»
// changes them with a NEW row, and nothing is ever deleted or updated.
import { describe, expect, it } from "vitest";
import {
  BUFFER_DEFAULT_FROM,
  defaultBufferPct,
  loadResolvedBufferAt,
  resolveBufferAt,
  type KitchenBufferRow,
} from "@/lib/restaurant/yield-buffer";
import { saveKitchenBuffer } from "@/lib/restaurant/kitchen-buffer-server";

const CENTRO = "loc-centro";
const NORTE = "loc-norte";
const row = (
  id: string,
  location: string,
  pct: number,
  from: string,
  created = "2026-01-01T00:00:00Z"
): KitchenBufferRow => ({
  id,
  location_id: location,
  buffer_pct: pct,
  effective_from: from,
  created_at: created,
});

describe("the cutover constant", () => {
  it("is one date, set to the release", () => {
    expect(BUFFER_DEFAULT_FROM).toBe("2026-11-02");
  });
});

describe("no row in force", () => {
  it("is 0% before the cutover and 5% on or after it", () => {
    expect(resolveBufferAt([], CENTRO, "2026-11-01")).toEqual({
      bufferPct: 0,
      effectiveFrom: null,
      isDefault: true,
    });
    expect(resolveBufferAt([], CENTRO, "2026-11-02").bufferPct).toBe(5);
    expect(resolveBufferAt([], CENTRO, "2027-03-15")).toEqual({
      bufferPct: 5,
      effectiveFrom: null,
      isDefault: true,
    });
    expect(defaultBufferPct("not-a-date")).toBe(0);
  });

  it("a restaurant created after the cutover has 5% from its first day", () => {
    expect(resolveBufferAt([], "new-restaurant", "2026-11-20").bufferPct).toBe(
      5
    );
  });

  it("a row of another restaurant does not count", () => {
    const rows = [row("r1", NORTE, 12, "2026-01-01")];
    expect(resolveBufferAt(rows, CENTRO, "2026-12-01").isDefault).toBe(true);
    expect(resolveBufferAt(rows, CENTRO, "2026-12-01").bufferPct).toBe(5);
  });
});

describe("a saved row wins", () => {
  it("over the default, before and after the cutover, without «predeterminado»", () => {
    const rows = [row("r1", CENTRO, 8, "2026-01-01")];
    expect(resolveBufferAt(rows, CENTRO, "2026-06-01")).toEqual({
      bufferPct: 8,
      effectiveFrom: "2026-01-01",
      isDefault: false,
    });
    expect(resolveBufferAt(rows, CENTRO, "2026-12-01").bufferPct).toBe(8);
  });
  it("a saved 0% is a saved value, not a default", () => {
    const rows = [row("r1", CENTRO, 0, "2026-10-01")];
    const r = resolveBufferAt(rows, CENTRO, "2026-12-01");
    expect(r.bufferPct).toBe(0);
    expect(r.isDefault).toBe(false);
  });
  it("a row that starts later does not apply yet: the default does", () => {
    const rows = [row("r1", CENTRO, 8, "2026-12-01")];
    expect(resolveBufferAt(rows, CENTRO, "2026-11-15")).toMatchObject({
      bufferPct: 5,
      isDefault: true,
    });
    expect(resolveBufferAt(rows, CENTRO, "2026-10-15")).toMatchObject({
      bufferPct: 0,
      isDefault: true,
    });
  });
});

/** A tiny in-memory kitchen_buffer_settings with the calls the code uses. */
function fakeDb(initial: KitchenBufferRow[] = []) {
  const rows = [...initial];
  const calls: string[] = [];
  let seq = 0;
  const supabase = {
    from(table: string) {
      expect(table).toBe("kitchen_buffer_settings");
      let op: "select" | "insert" = "select";
      let payload: Record<string, unknown> = {};
      const filters: Array<(r: KitchenBufferRow) => boolean> = [];
      let limit = Infinity;
      const run = () => {
        if (op === "insert") {
          const r = {
            id: `new-${++seq}`,
            location_id: payload.location_id as string,
            buffer_pct: payload.buffer_pct as number,
            effective_from: payload.effective_from as string,
            created_at: `2026-11-10T00:00:0${seq}Z`,
          };
          rows.push(r);
          return { data: r, error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        return {
          data: [...hit]
            .sort((a, b) =>
              (b.created_at ?? "").localeCompare(a.created_at ?? "")
            )
            .slice(0, limit),
          error: null,
        };
      };
      const chain: any = {
        select: () => chain,
        insert: (p: Record<string, unknown>) => {
          op = "insert";
          payload = p;
          calls.push("insert");
          return chain;
        },
        delete: () => {
          throw new Error("history rows are never deleted");
        },
        update: () => {
          throw new Error("history rows are never updated");
        },
        eq: (c: string, v: unknown) => {
          if (c === "location_id") filters.push((r) => r.location_id === v);
          return chain;
        },
        lte: (_c: string, v: string) => {
          filters.push((r) => r.effective_from <= v);
          return chain;
        },
        neq: (_c: string, v: string) => {
          filters.push((r) => r.id !== v);
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          limit = n;
          return chain;
        },
        single: () => Promise.resolve(run()),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return chain;
    },
  };
  return { supabase: supabase as never, rows, calls };
}

describe("reading never writes", () => {
  it("loadResolvedBufferAt only selects, and returns the default", async () => {
    const db = fakeDb();
    const r = await loadResolvedBufferAt(
      db.supabase,
      "c1",
      CENTRO,
      "2026-11-05"
    );
    expect(r).toMatchObject({ bufferPct: 5, isDefault: true });
    expect(db.calls).toEqual([]);
    expect(db.rows).toEqual([]);
  });
});

describe("saving", () => {
  const base = {
    companyId: "c1",
    userId: "u1",
    locationId: CENTRO,
    today: "2026-11-10",
    firstDataDate: "2026-09-15",
  };
  const at = (rows: KitchenBufferRow[], date: string) =>
    resolveBufferAt(rows, CENTRO, date).bufferPct;

  it("«Solo desde hoy» leaves past months unchanged", async () => {
    const db = fakeDb([row("old", CENTRO, 3, "2026-09-01")]);
    const res = await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "today",
    });
    expect(res).toEqual({ ok: true, effectiveFrom: "2026-11-10" });
    expect(db.calls).toEqual(["insert"]);
    expect(at(db.rows, "2026-10-15")).toBe(3); // past month: as before
    expect(at(db.rows, "2026-11-09")).toBe(3); // yesterday: as before
    expect(at(db.rows, "2026-11-10")).toBe(8);
    expect(at(db.rows, "2026-12-01")).toBe(8);
  });

  it("«Solo desde hoy» with no earlier row keeps the default in the past", async () => {
    const db = fakeDb();
    await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "today",
    });
    expect(at(db.rows, "2026-10-15")).toBe(0);
    expect(at(db.rows, "2026-11-05")).toBe(5);
    expect(at(db.rows, "2026-11-10")).toBe(8);
  });

  it("«Aplicar a semanas anteriores» changes the past with a new row, deleting nothing", async () => {
    const db = fakeDb([row("old", CENTRO, 3, "2026-10-01")]);
    const res = await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "all",
    });
    expect(res).toEqual({ ok: true, effectiveFrom: "2026-09-15" });
    expect(at(db.rows, "2026-09-20")).toBe(8);
    expect(at(db.rows, "2026-10-15")).toBe(8); // was 3
    expect(at(db.rows, "2026-11-10")).toBe(8);
    // The old row is still there; the new one is simply the newest.
    expect(db.rows.map((r) => r.id)).toContain("old");
    expect(db.rows).toHaveLength(2);
    expect(db.calls).toEqual(["insert"]);
  });

  it("a retroactive row followed by a «desde hoy» row: the later row wins from its date", async () => {
    const db = fakeDb();
    await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "all",
    });
    await saveKitchenBuffer({
      ...base,
      today: "2026-11-20",
      supabase: db.supabase,
      bufferPct: 12,
      scope: "today",
    });
    expect(at(db.rows, "2026-09-20")).toBe(8); // the retroactive row
    expect(at(db.rows, "2026-11-19")).toBe(8);
    expect(at(db.rows, "2026-11-20")).toBe(12); // desde hoy
    expect(at(db.rows, "2026-12-31")).toBe(12);
    expect(db.rows).toHaveLength(2);
    expect(db.calls).toEqual(["insert", "insert"]);
  });

  it("a second retroactive row wins everywhere again; nothing is lost", async () => {
    const db = fakeDb();
    await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "all",
    });
    await saveKitchenBuffer({
      ...base,
      today: "2026-11-20",
      supabase: db.supabase,
      bufferPct: 12,
      scope: "today",
    });
    await saveKitchenBuffer({
      ...base,
      today: "2026-11-25",
      supabase: db.supabase,
      bufferPct: 6,
      scope: "all",
    });
    expect(at(db.rows, "2026-09-20")).toBe(6);
    expect(at(db.rows, "2026-12-31")).toBe(6);
    expect(db.rows).toHaveLength(3);
  });

  it("another restaurant's history is untouched", async () => {
    const db = fakeDb([row("norte", NORTE, 12, "2026-10-01")]);
    await saveKitchenBuffer({
      ...base,
      supabase: db.supabase,
      bufferPct: 8,
      scope: "all",
    });
    expect(resolveBufferAt(db.rows, NORTE, "2026-10-15").bufferPct).toBe(12);
  });

  it("refuses anything outside 0–30 and writes nothing", async () => {
    for (const bad of [-1, 30.01, 31, NaN, Infinity]) {
      const db = fakeDb();
      const res = await saveKitchenBuffer({
        ...base,
        supabase: db.supabase,
        bufferPct: bad,
        scope: "today",
      });
      expect(res).toEqual({ ok: false, error: "invalid" });
      expect(db.calls).toEqual([]);
    }
    const db = fakeDb();
    expect(
      (
        await saveKitchenBuffer({
          ...base,
          supabase: db.supabase,
          bufferPct: 0,
          scope: "today",
        })
      ).ok
    ).toBe(true);
    expect(
      (
        await saveKitchenBuffer({
          ...base,
          supabase: db.supabase,
          bufferPct: 30,
          scope: "today",
        })
      ).ok
    ).toBe(true);
  });
});
