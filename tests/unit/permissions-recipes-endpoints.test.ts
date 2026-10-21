// One allow test and one deny test per recipe/menu/groups/prices endpoint that
// now asks lib/auth (resolveActor + requireCapability). The role is read with
// the admin client and Milton staff through isUserAdminServer: both mocked.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryEditorStore,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const world = vi.hoisted(() => ({
  role: "owner" as string | null,
  staff: false,
  store: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: world.role === null ? null : { role: world.role },
      error: null,
    }),
  };
  return { createAdminClient: () => chain };
});
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => world.staff,
}));
// A database that answers every query with no rows, so a request that gets
// past the role check never crashes in the background.
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => {
    const empty: unknown = new Proxy(() => empty, {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) =>
              resolve({ data: [], error: null, count: 0 })
          : empty,
      apply: () => empty,
    });
    return { ok: true, supabase: empty, companyId: "co-1", userId: "u-1" };
  },
}));
vi.mock("@/lib/restaurant/recipe-costing/editor-store", () => ({
  createSupabaseEditorStore: () => world.store,
}));

const UUID = "11111111-1111-4111-8111-111111111111";

function json(path: string, body: unknown, method = "POST") {
  return new NextRequest(`http://localhost/api/restaurant/${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function importForm() {
  const form = new FormData();
  form.set("mode", "apply");
  form.set("file", new File([new Uint8Array([1, 2, 3])], "costos.xlsx"));
  return new NextRequest("http://localhost/api/restaurant/recipes/import", {
    method: "POST",
    body: form,
  });
}

interface Case {
  name: string;
  load: () => Promise<{ POST?: (r: NextRequest) => Promise<Response> }>;
  request: () => NextRequest;
  message: string;
  /** Roles that pass; the rest are denied. */
  allowed?: string[];
}

const OWNER_ADMIN_MANAGER = ["owner", "admin", "manager"];

const CASES: Case[] = [
  {
    name: "menu-dishes (menu.manage)",
    load: () => import("@/app/api/restaurant/menu-dishes/route"),
    request: () => json("menu-dishes", {}),
    message: "Tu rol no puede cambiar los platos del menú.",
  },
  {
    name: "item-groups (groups.manage)",
    load: () => import("@/app/api/restaurant/item-groups/route"),
    request: () => json("item-groups", { ops: {} }),
    message: "Tu rol no puede cambiar las agrupaciones.",
  },
  {
    name: "item-groups/suggest (groups.manage)",
    load: () => import("@/app/api/restaurant/item-groups/suggest/route"),
    request: () => json("item-groups/suggest", { scope: "product", items: [] }),
    message: "Tu rol no puede cambiar las agrupaciones.",
  },
  {
    name: "ingredients/archive (ingredients.manage)",
    load: () => import("@/app/api/restaurant/ingredients/archive/route"),
    request: () => json("ingredients/archive", { ids: [UUID] }),
    message: "Tu rol no puede archivar ingredientes.",
  },
  {
    name: "ingredients/duplicates/decide (ingredients.manage)",
    load: () =>
      import("@/app/api/restaurant/ingredients/duplicates/decide/route"),
    request: () => json("ingredients/duplicates/decide", {}),
    message: "Tu rol no puede unir ni descartar ingredientes.",
  },
  {
    name: "recipes/suggestions (recipes.edit)",
    load: () => import("@/app/api/restaurant/recipes/suggestions/route"),
    request: () => json("recipes/suggestions", { limit: 5 }),
    message: "Tu rol no puede preparar recetas.",
  },
  {
    name: "recipes/menu (recipes.edit)",
    load: () => import("@/app/api/restaurant/recipes/menu/route"),
    request: () => json("recipes/menu", { text: "Pollo asado 12" }),
    message: "Tu rol no puede preparar recetas.",
  },
  {
    name: "recipes/last-file (imports.run)",
    load: () => import("@/app/api/restaurant/recipes/last-file/route"),
    request: () =>
      json("recipes/last-file", { odoo_product_id: 1, recipe_key: "k" }),
    message: "Tu rol no puede importar recetas.",
  },
  {
    name: "recipes/import apply (imports.run)",
    load: () => import("@/app/api/restaurant/recipes/import/route"),
    request: importForm,
    message: "Tu rol no puede importar recetas.",
  },
  {
    name: "pos/links/create (links.confirm)",
    load: () => import("@/app/api/restaurant/pos/links/create/route"),
    request: () =>
      json("pos/links/create", { odoo_product_id: 1, odoo_name: "Pollo" }),
    message: "Tu rol no puede vincular productos.",
  },
  {
    name: "pos/links/change (links.confirm)",
    load: () => import("@/app/api/restaurant/pos/links/change/route"),
    request: () =>
      json("pos/links/change", { odoo_product_id: 1, menu_item_id: "m1" }),
    message: "Tu rol no puede vincular productos.",
  },
  {
    name: "pos/links/undo (links.confirm)",
    load: () => import("@/app/api/restaurant/pos/links/undo/route"),
    request: () => json("pos/links/undo", { odoo_product_id: 1 }),
    message: "Tu rol no puede vincular productos.",
  },
  {
    name: "ingredient-costs POST (prices.edit)",
    load: () => import("@/app/api/restaurant/ingredient-costs/route"),
    request: () => json("ingredient-costs", {}),
    message: "Tu rol no puede cambiar precios.",
  },
  {
    name: "unit-conversions POST (prices.edit)",
    load: () =>
      import("@/app/api/restaurant/ingredients/unit-conversions/route"),
    request: () => json("ingredients/unit-conversions", {}),
    message: "Tu rol no puede cambiar precios.",
  },
  {
    name: "costs/reset (costs.reset)",
    load: () => import("@/app/api/restaurant/costs/reset/route"),
    request: () => json("costs/reset", {}),
    message: "",
    allowed: ["owner", "admin"],
  },
];

async function call(c: Case): Promise<Response | "threw"> {
  const mod = await c.load();
  try {
    return await mod.POST!(c.request());
  } catch {
    // Past the permission check the fake database is not enough: that is
    // an allow for this test.
    return "threw";
  }
}

beforeEach(() => {
  world.role = "owner";
  world.staff = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("recipe, menu, groups and price endpoints use the one helper", () => {
  for (const c of CASES) {
    const allowed = c.allowed ?? OWNER_ADMIN_MANAGER;

    it(`${c.name}: allows ${allowed.join("/")}, and Milton staff where the table says so`, async () => {
      for (const role of allowed) {
        world.role = role;
        const res = await call(c);
        expect(res === "threw" || res.status !== 403, role).toBe(true);
      }
      // " Owner " is the owner.
      world.role = " Owner ";
      const spaced = await call(c);
      expect(spaced === "threw" || spaced.status !== 403).toBe(true);
    });

    it(`${c.name}: denies a viewer with the Spanish message`, async () => {
      for (const role of ["viewer", "member", "analyst", null]) {
        world.role = role;
        const res = await call(c);
        expect(res, String(role)).not.toBe("threw");
        const response = res as Response;
        expect(response.status, String(role)).toBe(403);
        const body = (await response.json()) as {
          error: string;
          code?: string;
        };
        if (c.message) expect(body.error).toBe(c.message);
        else {
          expect(body.error).toMatch(/dueño|admin|propietario|permiso/i);
          expect(body.code).toBe("forbidden");
        }
      }
    });
  }

  it("a manager does not reset a company; Milton staff does not either", async () => {
    const c = CASES.find((x) => x.name.startsWith("costs/reset"))!;
    world.role = "manager";
    expect(((await call(c)) as Response).status).toBe(403);
    world.role = "owner";
    world.staff = false;
    world.role = null;
    world.staff = true;
    expect(((await call(c)) as Response).status).toBe(403);
  });

  it("Milton staff without a membership may edit recipes", async () => {
    world.role = null;
    world.staff = true;
    const c = CASES.find((x) => x.name.startsWith("recipes/suggestions"))!;
    const res = await call(c);
    expect(res === "threw" || res.status !== 403).toBe(true);
  });
});

describe("ingredient-costs and unit-conversions need prices.edit", () => {
  it("deny a viewer and a member with «Tu rol no puede cambiar precios.»", async () => {
    const costs = await import("@/app/api/restaurant/ingredient-costs/route");
    const conv =
      await import("@/app/api/restaurant/ingredients/unit-conversions/route");
    for (const role of ["viewer", "member"]) {
      world.role = role;
      for (const res of [
        await costs.POST(json("ingredient-costs", {})),
        await costs.DELETE(
          json("ingredient-costs?id=x", {}, "DELETE") as never
        ),
        await conv.POST(json("ingredients/unit-conversions", {}) as never),
        await conv.DELETE(
          json("ingredients/unit-conversions", {}, "DELETE") as never
        ),
      ]) {
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe(
          "Tu rol no puede cambiar precios."
        );
      }
    }
  });

  it("allow an owner and a manager past the role check", async () => {
    const costs = await import("@/app/api/restaurant/ingredient-costs/route");
    for (const role of ["owner", "manager", " Manager "]) {
      world.role = role;
      const res = await costs.POST(json("ingredient-costs", {}));
      expect(res.status).toBe(400); // validation, not 403
    }
  });
});

describe("recipes/editor", () => {
  function approvedStore() {
    return createMemoryEditorStore(
      memoryEditorState({
        ingredients: [{ id: "i-sal", name: "Sal fina", default_unit: "oz" }],
        version: {
          id: "v1",
          status: "approved",
          kind: "dish",
          menu_item_id: "m1",
        },
        link: { id: "link-1", menu_item_id: "m1", evidence: {} },
      })
    );
  }
  const edit = () =>
    json("recipes/editor", {
      action: "set_price",
      odoo_product_id: 7,
      ingredient_id: "i-sal",
      unit: "oz",
      unit_cost: 0.07,
    });

  it("an owner (also ' Owner ') editing an APPROVED recipe is not a 403", async () => {
    const { POST } = await import("@/app/api/restaurant/recipes/editor/route");
    for (const role of ["owner", " Owner ", "manager"]) {
      world.role = role;
      world.store = approvedStore();
      const res = await POST(edit());
      expect(res.status, role).not.toBe(403);
    }
  });

  it("a viewer is denied with «Tu rol no puede editar recetas.»", async () => {
    const { POST } = await import("@/app/api/restaurant/recipes/editor/route");
    world.role = "viewer";
    world.store = approvedStore();
    const res = await POST(edit());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Tu rol no puede editar recetas."
    );
  });
});
