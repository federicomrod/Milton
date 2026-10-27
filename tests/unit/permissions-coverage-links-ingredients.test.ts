// Every write route of the links / ingredients / preparations / menu items /
// import draft / agents area asks lib/auth (requireCapability): owner, admin,
// manager and Milton staff pass; member, viewer, analyst and no membership get
// the Spanish 403 and the database and the AI are never touched.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  role: "owner" as string | null,
  staff: false,
  dbTouches: 0,
  aiCalls: 0,
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
vi.mock("@/lib/openai-client", () => ({
  openai: {
    chat: {
      completions: {
        create: async () => {
          world.aiCalls++;
          return { choices: [{ message: { content: "{}" } }] };
        },
      },
    },
  },
}));
// A database that answers every query with no rows and counts each touch.
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => {
    const empty: unknown = new Proxy(() => empty, {
      get: (_t, prop) => {
        world.dbTouches++;
        return prop === "then"
          ? (resolve: (v: unknown) => void) =>
              resolve({ data: [], error: null, count: 0 })
          : empty;
      },
      apply: () => {
        world.dbTouches++;
        return empty;
      },
    });
    return { ok: true, supabase: empty, companyId: "co-1", userId: "u-1" };
  },
}));

const UUID = "11111111-1111-4111-8111-111111111111";
const BASE = "http://localhost/api/restaurant/";

function json(path: string, method: string, body: unknown = {}) {
  return new NextRequest(BASE + path, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function form(path: string) {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([1, 2, 3])], "costos.xlsx"));
  return new NextRequest(BASE + path, { method: "POST", body: f });
}

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
interface Case {
  name: string;
  method: string;
  load: () => Promise<Record<string, unknown>>;
  request: () => NextRequest;
  message: string;
  ctx?: unknown;
}

const params = { params: Promise.resolve({ id: UUID }) };
const LINKS = "Tu rol no puede vincular productos.";
const INGR = "Tu rol no puede cambiar los ingredientes.";
const DUP = "Tu rol no puede unir ni descartar ingredientes.";
const RECIPES = "Tu rol no puede editar recetas.";
const MENU = "Tu rol no puede cambiar los platos del menú.";
const IMPORTS = "Tu rol no puede importar recetas.";

const CASES: Case[] = [
  {
    name: "pos-mappings POST (links.confirm)",
    method: "POST",
    load: () => import("@/app/api/restaurant/pos-mappings/route"),
    request: () => json("pos-mappings", "POST"),
    message: LINKS,
  },
  {
    name: "pos-mappings DELETE (links.confirm)",
    method: "DELETE",
    load: () => import("@/app/api/restaurant/pos-mappings/route"),
    request: () => json("pos-mappings?raw_pos_item_name=x", "DELETE"),
    message: LINKS,
  },
  {
    name: "ingredients POST (ingredients.manage)",
    method: "POST",
    load: () => import("@/app/api/restaurant/ingredients/route"),
    request: () => json("ingredients", "POST"),
    message: INGR,
  },
  {
    name: "ingredients/[id] PATCH (ingredients.manage)",
    method: "PATCH",
    load: () => import("@/app/api/restaurant/ingredients/[id]/route"),
    request: () => json(`ingredients/${UUID}`, "PATCH"),
    message: INGR,
    ctx: params,
  },
  {
    name: "ingredients/duplicates/merge POST (ingredients.manage)",
    method: "POST",
    load: () =>
      import("@/app/api/restaurant/ingredients/duplicates/merge/route"),
    request: () => json("ingredients/duplicates/merge", "POST"),
    message: DUP,
  },
  {
    name: "ingredients/duplicates/undo POST (ingredients.manage)",
    method: "POST",
    load: () =>
      import("@/app/api/restaurant/ingredients/duplicates/undo/route"),
    request: () => json("ingredients/duplicates/undo", "POST"),
    message: DUP,
  },
  {
    name: "ingredients/duplicates/decide POST (ingredients.manage)",
    method: "POST",
    load: () =>
      import("@/app/api/restaurant/ingredients/duplicates/decide/route"),
    request: () => json("ingredients/duplicates/decide", "POST"),
    message: DUP,
  },
  {
    name: "ingredients/duplicates/suggest POST (ingredients.manage)",
    method: "POST",
    load: () =>
      import("@/app/api/restaurant/ingredients/duplicates/suggest/route"),
    request: () => json("ingredients/duplicates/suggest", "POST"),
    message: DUP,
  },
  {
    name: "prepared-components POST (recipes.edit)",
    method: "POST",
    load: () => import("@/app/api/restaurant/prepared-components/route"),
    request: () => json("prepared-components", "POST"),
    message: RECIPES,
  },
  {
    name: "prepared-components/[id] PATCH (recipes.edit)",
    method: "PATCH",
    load: () => import("@/app/api/restaurant/prepared-components/[id]/route"),
    request: () => json(`prepared-components/${UUID}`, "PATCH"),
    message: RECIPES,
    ctx: params,
  },
  {
    name: "prepared-components/[id] DELETE (recipes.edit)",
    method: "DELETE",
    load: () => import("@/app/api/restaurant/prepared-components/[id]/route"),
    request: () => json(`prepared-components/${UUID}`, "DELETE"),
    message: RECIPES,
    ctx: params,
  },
  {
    name: "menu-items POST (menu.manage)",
    method: "POST",
    load: () => import("@/app/api/restaurant/menu-items/route"),
    request: () => json("menu-items", "POST"),
    message: MENU,
  },
  {
    name: "recipes/upload-draft POST (imports.run)",
    method: "POST",
    load: () => import("@/app/api/restaurant/recipes/upload-draft/route"),
    request: () => form("recipes/upload-draft"),
    message: IMPORTS,
  },
  {
    name: "recipes/upload-draft PATCH (imports.run)",
    method: "PATCH",
    load: () => import("@/app/api/restaurant/recipes/upload-draft/route"),
    request: () => json("recipes/upload-draft", "PATCH"),
    message: IMPORTS,
  },
  {
    name: "recipes/upload-draft DELETE (imports.run)",
    method: "DELETE",
    load: () => import("@/app/api/restaurant/recipes/upload-draft/route"),
    request: () => json("recipes/upload-draft", "DELETE"),
    message: IMPORTS,
  },
];

async function call(c: Case): Promise<Response | "threw"> {
  const mod = await c.load();
  const handler = mod[c.method] as Handler;
  try {
    return await handler(c.request(), c.ctx);
  } catch {
    // Past the permission check the fake database is not enough: an allow.
    return "threw";
  }
}

beforeEach(() => {
  world.role = "owner";
  world.staff = false;
  world.dbTouches = 0;
  world.aiCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe.each(CASES)("$name", (c) => {
  it.each(["owner", "admin", "manager"])("lets %s through", async (role) => {
    world.role = role;
    const res = await call(c);
    if (res !== "threw") expect(res.status).not.toBe(403);
  });

  it("lets Milton staff through (no membership)", async () => {
    world.role = null;
    world.staff = true;
    const res = await call(c);
    if (res !== "threw") expect(res.status).not.toBe(403);
  });

  it.each(["member", "viewer", "analyst", null])(
    "refuses role %s with the Spanish message and touches nothing",
    async (role) => {
      world.role = role;
      const res = await call(c);
      expect(res).not.toBe("threw");
      const r = res as Response;
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe(c.message);
      expect(world.dbTouches).toBe(0);
      expect(world.aiCalls).toBe(0);
    }
  );
});
