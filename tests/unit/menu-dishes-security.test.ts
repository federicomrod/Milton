// #237 review, items 1, 2 and 4: "Mover variante" and "Excluir plato"
// never trust a dish id from the client (another company's dish is not
// found; a restaurant-only dish only takes that restaurant's variants),
// a dish name also finds restaurant-only dishes, and saving Milton's
// grouping writes only the variants with none, in a few bulk requests.
// Synthetic ids and names only.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DISH_NOT_FOUND,
  DISH_OTHER_RESTAURANT,
  MenuDishError,
  excludeDish,
  moveVariant,
  syncMenuDishes,
} from "@/lib/restaurant/menu-dishes/menu-dishes-server";
import type {
  MenuDish,
  MenuDishVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";

type Row = Record<string, unknown>;

interface Call {
  table: string;
  op: "select" | "update" | "insert" | "rpc";
  payload?: unknown;
}

/** Tables in memory; every request is recorded. No RLS: the code under
 *  test must scope by company itself. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  let seq = 0;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let op: Call["op"] = "select";
      let payload: Row | Row[] = {};
      let limit = Infinity;
      let returning = false;
      const match = (r: Row) => filters.every((f) => f(r));
      const run = () => {
        calls.push({
          table,
          op,
          payload: op === "select" ? undefined : payload,
        });
        if (op === "update") {
          const hit = rows.filter(match);
          for (const r of hit) Object.assign(r, payload);
          return { data: null, error: null };
        }
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map(
            (p) => ({ id: `${table}-${++seq}`, ...p })
          );
          rows.push(...list);
          return { data: returning ? list : null, error: null };
        }
        return { data: rows.filter(match).slice(0, limit), error: null };
      };
      const b = {
        select() {
          if (op !== "select") returning = true;
          return b;
        },
        eq(k: string, v: unknown) {
          filters.push((r) => r[k] === v);
          return b;
        },
        is(k: string, v: unknown) {
          filters.push((r) => (r[k] ?? null) === v);
          return b;
        },
        in(k: string, v: unknown[]) {
          filters.push((r) => v.includes(r[k]));
          return b;
        },
        ilike(k: string, v: string) {
          const want = v.replace(/\\([\\%_])/g, "$1").toLowerCase();
          filters.push((r) => String(r[k]).toLowerCase() === want);
          return b;
        },
        limit(n: number) {
          limit = n;
          return b;
        },
        update(p: Row) {
          op = "update";
          payload = p;
          return b;
        },
        insert(p: Row | Row[]) {
          op = "insert";
          payload = p;
          return b;
        },
        single() {
          const r = run();
          const data = Array.isArray(r.data) ? r.data[0] : r.data;
          return Promise.resolve({ data, error: null });
        },
        then(resolve: (v: unknown) => void) {
          return resolve(run());
        },
      };
      return b;
    },
    rpc(name: string, args: { p_company_id: string; p_rows: Row[] }) {
      calls.push({ table: name, op: "rpc", payload: args });
      let filled = 0;
      for (const r of args.p_rows) {
        const links = (tables.pos_product_links ?? []).filter(
          (l) =>
            l.company_id === args.p_company_id &&
            l.odoo_product_id === r.odoo_product_id &&
            !l.menu_dish_id &&
            !l.excluded_reason
        );
        for (const l of links) Object.assign(l, r);
        filled += links.length;
      }
      return Promise.resolve({ data: [{ filled, created: 0 }], error: null });
    },
  };
  const writes = () => calls.filter((c) => c.op !== "select");
  return { client: client as unknown as SupabaseClient, calls, writes, tables };
}

const CO = "co-1";
const OTHER = "co-2";
const A = "loc-a";
const B = "loc-b";

function db() {
  return fakeDb({
    menu_dishes: [
      {
        id: "d-mine",
        company_id: CO,
        name: "Churrasco",
        restaurant_id: null,
        status: "confirmed",
      },
      {
        id: "d-foreign",
        company_id: OTHER,
        name: "Plato Ajeno",
        restaurant_id: null,
        status: "confirmed",
      },
      {
        id: "d-only-a",
        company_id: CO,
        name: "Especial de la Casa",
        restaurant_id: A,
        status: "confirmed",
      },
    ],
    pos_product_links: [
      {
        id: "l-shared",
        company_id: CO,
        location_id: null,
        odoo_product_id: 10,
        menu_dish_id: null,
        excluded_reason: null,
      },
      {
        id: "l-b",
        company_id: CO,
        location_id: B,
        odoo_product_id: 20,
        menu_dish_id: null,
        excluded_reason: null,
      },
      {
        id: "l-a",
        company_id: CO,
        location_id: A,
        odoo_product_id: 30,
        menu_dish_id: null,
        excluded_reason: null,
      },
      {
        id: "l-30-b",
        company_id: CO,
        location_id: B,
        odoo_product_id: 30,
        menu_dish_id: null,
        excluded_reason: null,
      },
    ],
  });
}

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as MenuDishError;
  }
  throw new Error("expected a rejection");
}

describe("Mover variante: the dish id is checked on the server", () => {
  it("refuses another company's dish id and writes nothing", async () => {
    const f = db();
    const err = await rejection(
      moveVariant(f.client, CO, {
        odoo_product_id: 10,
        odoo_name: "Churrasco (6 oz)",
        menu_dish_id: "d-foreign",
      })
    );
    expect(err).toBeInstanceOf(MenuDishError);
    expect(err.status).toBe(404);
    expect(err.message).toBe(DISH_NOT_FOUND);
    expect(f.writes()).toHaveLength(0);
    expect(f.tables.pos_product_links[0].menu_dish_id).toBeNull();
  });

  it("a restaurant-only dish refuses a variant with no link in that restaurant", async () => {
    const f = db();
    const err = await rejection(
      moveVariant(f.client, CO, {
        odoo_product_id: 20,
        odoo_name: "Especial (B)",
        menu_dish_id: "d-only-a",
      })
    );
    expect(err.status).toBe(400);
    expect(err.message).toBe(DISH_OTHER_RESTAURANT);
    expect(f.writes()).toHaveLength(0);
  });

  it("a shared-only variant cannot join a restaurant-only dish either", async () => {
    const f = db();
    const err = await rejection(
      moveVariant(f.client, CO, {
        odoo_product_id: 10,
        odoo_name: "Churrasco",
        menu_dish_id: "d-only-a",
      })
    );
    expect(err.message).toBe(DISH_OTHER_RESTAURANT);
    expect(f.writes()).toHaveLength(0);
  });

  it("a restaurant-only dish takes only that restaurant's link", async () => {
    const f = db();
    await moveVariant(f.client, CO, {
      odoo_product_id: 30,
      odoo_name: "Especial",
      menu_dish_id: "d-only-a",
    });
    const links = f.tables.pos_product_links;
    expect(links.find((l) => l.id === "l-a")?.menu_dish_id).toBe("d-only-a");
    expect(links.find((l) => l.id === "l-30-b")?.menu_dish_id).toBeNull();
  });

  it("a dish of the caller's company is saved on the variant", async () => {
    const f = db();
    const r = await moveVariant(f.client, CO, {
      odoo_product_id: 10,
      odoo_name: "Churrasco (8 oz)",
      menu_dish_id: "d-mine",
    });
    expect(r.menu_dish_id).toBe("d-mine");
    expect(f.tables.pos_product_links[0].menu_dish_id).toBe("d-mine");
  });

  it("finds a restaurant-only dish by name instead of creating a copy", async () => {
    const f = db();
    const r = await moveVariant(f.client, CO, {
      odoo_product_id: 30,
      odoo_name: "Especial",
      dish_name: "especial de la casa",
    });
    expect(r.menu_dish_id).toBe("d-only-a");
    expect(f.tables.menu_dishes).toHaveLength(3);
  });

  it("a name never finds another company's dish", async () => {
    const f = db();
    const r = await moveVariant(f.client, CO, {
      odoo_product_id: 10,
      odoo_name: "Churrasco",
      dish_name: "Plato Ajeno",
    });
    expect(r.menu_dish_id).not.toBe("d-foreign");
    const created = f.tables.menu_dishes.find((d) => d.id === r.menu_dish_id);
    expect(created?.company_id).toBe(CO);
  });
});

describe("Excluir plato: the dish id is checked on the server", () => {
  it("refuses another company's dish id and writes nothing", async () => {
    const f = db();
    const err = await rejection(
      excludeDish(f.client, CO, {
        dish_name: "Plato Ajeno",
        menu_dish_id: "d-foreign",
        variants: [{ odoo_product_id: 10, odoo_name: "Churrasco" }],
        excluded: true,
      })
    );
    expect(err.status).toBe(404);
    expect(f.writes()).toHaveLength(0);
    expect(f.tables.menu_dishes[1].status).toBe("confirmed");
  });

  it("a restaurant-only dish refuses another restaurant's variants", async () => {
    const f = db();
    const err = await rejection(
      excludeDish(f.client, CO, {
        dish_name: "Especial de la Casa",
        menu_dish_id: "d-only-a",
        variants: [{ odoo_product_id: 20, odoo_name: "Especial (B)" }],
        excluded: true,
      })
    );
    expect(err.message).toBe(DISH_OTHER_RESTAURANT);
    expect(f.writes()).toHaveLength(0);
  });
});

function variant(id: number, saved: boolean): MenuDishVariant {
  return {
    odoo_product_id: id,
    key: String(id),
    sales_scope: null,
    saved,
    name: `Plato ${id}`,
    size: null,
    size_unit: null,
    side: null,
    sides: [],
    cooking_point: null,
    channel: "salón",
    is_promo: false,
    units: 1,
    net_sales: 10,
    unit_cost: null,
    cost_total: null,
    margin: null,
    food_cost_pct: null,
    cost_basis: null,
    status: "sin_receta",
    covered: false,
  };
}

function dish(
  id: string,
  name: string,
  variants: MenuDishVariant[],
  over: Partial<MenuDish> = {}
): MenuDish {
  return {
    id,
    stored: !id.startsWith("auto:"),
    name,
    category: null,
    source: "name",
    status: "suggested",
    excluded_reason: null,
    variants,
    units: 0,
    net_sales: 0,
    share_of_food_sales: 0,
    cost_known_sales: 0,
    cost_total: null,
    food_cost_pct: null,
    margin: null,
    margin_pct: null,
    coverage: 0,
    cost_status: "sin_receta",
    base_odoo_product_id: null,
    base_portion_qty: null,
    excel_total: null,
    excel_diff_flag: false,
    ...over,
  };
}

describe("Saving Milton's grouping", () => {
  it("writes nothing when every variant is already grouped", async () => {
    const f = db();
    const r = await syncMenuDishes(
      f.client,
      CO,
      [dish("d-mine", "Churrasco", [variant(10, true)])],
      []
    );
    expect(r.write_requests).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("sends only the variants with no grouping, in a few bulk requests", async () => {
    const f = db();
    const many = Array.from({ length: 40 }, (_, i) => variant(100 + i, false));
    const r = await syncMenuDishes(
      f.client,
      CO,
      [
        dish("d-mine", "Churrasco", [variant(10, true), variant(11, false)]),
        dish("auto:sopa", "Sopa Nueva", many),
        dish("auto:postre", "Postre Nuevo", [variant(200, false)]),
      ],
      [
        dish("auto:bebida", "Refresco", [variant(300, false)], {
          status: "excluded",
          excluded_reason: "bebida",
        }),
      ]
    );
    // One read of the dishes, one insert of the new ones, one fill call:
    // 3 requests for 43 variants (before: 1–3 per variant).
    expect(f.calls).toHaveLength(3);
    expect(r.write_requests).toBe(3);
    expect(r.dishes_created).toBe(2);
    const fill = f.calls.find((c) => c.op === "rpc")?.payload as {
      p_company_id: string;
      p_rows: Row[];
    };
    expect(fill.p_company_id).toBe(CO);
    const sent = fill.p_rows.map((row) => row.odoo_product_id);
    expect(sent).not.toContain(10);
    expect(sent).toHaveLength(43);
    expect(
      fill.p_rows.find((row) => row.odoo_product_id === 300)?.excluded_reason
    ).toBe("bebida");
    const newIds = new Set(
      f.tables.menu_dishes.filter((d) => d.company_id === CO).map((d) => d.id)
    );
    for (const row of fill.p_rows) {
      if (row.menu_dish_id) expect(newIds.has(row.menu_dish_id)).toBe(true);
    }
  });
});
