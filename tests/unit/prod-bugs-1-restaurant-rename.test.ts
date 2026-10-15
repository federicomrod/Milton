// Prod bugs 1, item 7: rename (and archive) restaurants.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PGlite } from "@electric-sql/pglite";
import {
  MAX_RESTAURANT_NAME,
  validateRestaurantName,
} from "@/lib/restaurant/restaurant-name";

const CO = "11111111-1111-4111-8111-111111111111";
const L1 = "a1111111-1111-4111-8111-111111111111";
const L2 = "a2222222-2222-4222-8222-222222222222";
const FOREIGN = "f9999999-9999-4999-8999-999999999999";

describe("validateRestaurantName", () => {
  it("trims, needs 1–80 characters", () => {
    expect(validateRestaurantName("  Casa Norte  ", [])).toEqual({
      ok: true,
      name: "Casa Norte",
    });
    expect(validateRestaurantName("   ", [])).toMatchObject({ ok: false });
    expect(validateRestaurantName("", [])).toMatchObject({ ok: false });
    expect(validateRestaurantName(undefined, [])).toMatchObject({ ok: false });
    expect(
      validateRestaurantName("x".repeat(MAX_RESTAURANT_NAME), [])
    ).toMatchObject({ ok: true });
    expect(
      validateRestaurantName("x".repeat(MAX_RESTAURANT_NAME + 1), [])
    ).toMatchObject({ ok: false });
  });
  it("is unique in the company, ignoring case and accents; its own name does not count", () => {
    expect(validateRestaurantName("café  sur", ["Café Sur"])).toEqual({
      ok: false,
      message: "Ya tienes un restaurante con ese nombre.",
    });
    expect(validateRestaurantName("Cafe Sur", ["Café Sur"])).toMatchObject({
      ok: false,
    });
    expect(validateRestaurantName("Café Sur", [])).toMatchObject({ ok: true });
  });
});

// ---- the API route ----
type Row = { id: string; name: string };
let rows: Row[] = [];
let updateCalls: Array<{
  patch: Record<string, unknown>;
  eq: Array<[string, string]>;
}> = [];
let rpcResult: { error: { code?: string; message: string } | null } = {
  error: null,
};
let rpcCalls: Array<[string, Record<string, unknown>]> = [];
let authed = true;

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => {
    if (!authed) {
      const { NextResponse } = await import("next/server");
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    return {
      ok: true,
      companyId: CO,
      userId: "u",
      supabase: {
        from: () => ({
          select: () => ({ eq: async () => ({ data: rows, error: null }) }),
          update: (patch: Record<string, unknown>) => {
            const call = { patch, eq: [] as Array<[string, string]> };
            updateCalls.push(call);
            const chain = {
              eq: (k: string, v: string) => {
                call.eq.push([k, v]);
                return call.eq.length >= 2
                  ? Promise.resolve({ error: null })
                  : chain;
              },
            };
            return chain;
          },
        }),
        rpc: async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push([fn, args]);
          return rpcResult;
        },
      },
    };
  },
}));

const patch = async (id: string, body: unknown) => {
  const { PATCH } = await import("@/app/api/restaurant/locations/[id]/route");
  const res = await PATCH(
    new Request("https://x.test", {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
};

describe("PATCH /api/restaurant/locations/:id", () => {
  beforeEach(() => {
    rows = [
      { id: L1, name: "Uno" },
      { id: L2, name: "Dos" },
    ];
    updateCalls = [];
    rpcCalls = [];
    rpcResult = { error: null };
    authed = true;
  });
  it("needs a signed-in member: no session is a 401 and nothing is written", async () => {
    authed = false;
    expect((await patch(L1, { name: "Nuevo" })).status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });
  it("only the caller's company: a foreign or garbage id is a 404 (it never reveals it exists elsewhere)", async () => {
    expect((await patch(FOREIGN, { name: "Nuevo" })).status).toBe(404);
    expect((await patch("no-es-uuid", { name: "Nuevo" })).status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });
  it("renames: validated, scoped to the id AND the company", async () => {
    const r = await patch(L1, { name: "  Casa Norte " });
    expect(r).toMatchObject({
      status: 200,
      json: { id: L1, name: "Casa Norte" },
    });
    expect(updateCalls[0].patch.name).toBe("Casa Norte");
    expect(updateCalls[0].eq).toEqual([
      ["id", L1],
      ["company_id", CO],
    ]);
  });
  it("rejects an empty, a too long and a duplicate name (400)", async () => {
    expect((await patch(L1, { name: "  " })).status).toBe(400);
    expect((await patch(L1, { name: "x".repeat(81) })).status).toBe(400);
    const dup = await patch(L1, { name: "dos" });
    expect(dup).toMatchObject({
      status: 400,
      json: { error: "Ya tienes un restaurante con ese nombre." },
    });
    expect(updateCalls).toHaveLength(0);
    expect((await patch(L1, { name: "Uno" })).status).toBe(200); // its own name is fine
  });
  it("archive goes through restaurant_set_archived with the company from auth; its errors become clear statuses", async () => {
    expect((await patch(L2, { archived: true })).status).toBe(200);
    expect(rpcCalls[0]).toEqual([
      "restaurant_set_archived",
      { p_company_id: CO, p_location_id: L2, p_archived: true },
    ]);
    rpcResult = { error: { code: "42501", message: "not a member" } };
    expect((await patch(L2, { archived: true })).status).toBe(403);
    rpcResult = {
      error: {
        code: "22023",
        message: "No puedes archivar tu único restaurante activo.",
      },
    };
    expect(await patch(L2, { archived: true })).toMatchObject({
      status: 400,
      json: { error: "No puedes archivar tu único restaurante activo." },
    });
    rpcResult = {
      error: {
        code: "PGRST202",
        message: "Could not find the function public.restaurant_set_archived",
      },
    };
    expect(await patch(L2, { archived: true })).toMatchObject({ status: 409 });
  });
});

// ---- migration 055 ----
describe("migration 055 (archive)", () => {
  let db: PGlite;
  const MIG = join(
    process.cwd(),
    "supabase/migrations/055_restaurant_archive.sql"
  );
  const asMember = (c: string) =>
    db.exec(
      `CREATE OR REPLACE FUNCTION public.is_company_member(c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT c = '${c}'::uuid $$;`
    );
  const archive = (loc: string, on: boolean, company = CO) =>
    db.query(`SELECT public.restaurant_set_archived($1::uuid,$2::uuid,$3) r`, [
      company,
      loc,
      on,
    ]);
  const state = async () =>
    (
      await db.query<{ id: string; archived: boolean }>(
        `SELECT id, archived_at IS NOT NULL AS archived FROM restaurant_locations`
      )
    ).rows.sort((a, b) => (a.id < b.id ? -1 : 1));

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN others THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN others THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN others THEN NULL; END $$;
      CREATE TABLE public.restaurant_locations (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text NOT NULL, updated_at timestamptz DEFAULT now());
      INSERT INTO public.restaurant_locations (id, company_id, name) VALUES ('${L1}','${CO}','Uno'), ('${L2}','${CO}','Dos');
    `);
    await asMember(CO);
    const sql = readFileSync(MIG, "utf8");
    await db.exec(sql);
    await db.exec(sql); // additive and idempotent
  });
  it("adds a nullable archived_at and changes no row", async () => {
    expect(await state()).toEqual([
      { id: L1, archived: false },
      { id: L2, archived: false },
    ]);
  });
  it("archives and restores; data stays (nothing is deleted)", async () => {
    await archive(L2, true);
    expect(await state()).toEqual([
      { id: L1, archived: false },
      { id: L2, archived: true },
    ]);
    await archive(L2, false);
    expect((await state()).every((r) => !r.archived)).toBe(true);
    expect(
      (await db.query(`SELECT count(*)::int n FROM restaurant_locations`)).rows
    ).toEqual([{ n: 2 }]);
  });
  it("never archives the last active restaurant (22023, Spanish)", async () => {
    await archive(L2, true);
    await expect(archive(L1, true)).rejects.toMatchObject({
      code: "22023",
      message: "No puedes archivar tu único restaurante activo.",
    });
    expect((await state()).find((r) => r.id === L1)?.archived).toBe(false);
  });
  it("a non-member gets 42501; another company's restaurant is 22023; anon cannot execute", async () => {
    await asMember(FOREIGN);
    await expect(archive(L1, true)).rejects.toMatchObject({ code: "42501" });
    await asMember(CO);
    await expect(archive(FOREIGN, true)).rejects.toMatchObject({
      code: "22023",
    });
    const anon = await db.query<{ a: boolean }>(
      `SELECT has_function_privilege('anon','public.restaurant_set_archived(uuid,uuid,boolean)','execute') a`
    );
    expect(anon.rows[0].a).toBe(false);
    const auth = await db.query<{ a: boolean }>(
      `SELECT has_function_privilege('authenticated','public.restaurant_set_archived(uuid,uuid,boolean)','execute') a`
    );
    expect(auth.rows[0].a).toBe(true);
  });
});

describe("the app around it", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the switcher hides archived restaurants (one place) and does not repeat a failing select before 055", () => {
    const ctx = read("lib/restaurant/restaurant-context-server.ts");
    expect(ctx).toContain("!l.archived_at");
    expect(ctx).toContain("archivedColumnMissingUntil");
  });
  it("Configuración has a «Restaurante» tab with the inline rename", () => {
    expect(read("components/restaurant/settings/ConfigTabs.tsx")).toContain(
      "RESTAURANT_SETTINGS_HREF"
    );
    expect(read("lib/restaurant/navigation.ts")).toContain(
      'restaurant: "restaurante"'
    );
    const form = read("components/restaurant/settings/RestaurantNamesForm.tsx");
    expect(form).toContain("router.refresh()");
    expect(form).toContain("/api/restaurant/locations/");
  });
});
