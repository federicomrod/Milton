// Every write route of the prices family (price catalog, cost batch undo,
// suppliers, invoices) asks lib/auth for prices.edit BEFORE it reads the body,
// uploads a file or calls OpenAI. Roles come from a mocked admin client and
// Milton staff from a mocked isUserAdminServer.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  role: "owner" as string | null,
  staff: false,
  dbTouches: 0,
  openaiCalls: 0,
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
vi.mock("openai", () => {
  class OpenAI {
    constructor() {
      world.openaiCalls += 1;
    }
  }
  return { OpenAI, default: OpenAI };
});
// The route's own database counts every touch and answers with no rows.
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => {
    const empty: unknown = new Proxy(() => empty, {
      get: (_t, prop) => {
        world.dbTouches += 1;
        return prop === "then"
          ? (resolve: (v: unknown) => void) =>
              resolve({ data: [], error: null, count: 0 })
          : empty;
      },
      apply: () => empty,
    });
    return { ok: true, supabase: empty, companyId: "co-1", userId: "u-1" };
  },
}));

const MESSAGE = "Tu rol no puede cambiar precios.";
const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: ID }) };

function json(path: string, method: string, body: unknown = {}) {
  return new NextRequest(`http://localhost/api/restaurant/${path}`, {
    method,
    body: method === "DELETE" ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function form(path: string) {
  const data = new FormData();
  data.set("file", new File([new Uint8Array([1, 2, 3])], "x.xlsx"));
  return new NextRequest(`http://localhost/api/restaurant/${path}`, {
    method: "POST",
    body: data,
  });
}

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
interface Case {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  method: string;
  request: () => NextRequest;
}

const CASES: Case[] = [
  {
    name: "price-catalog POST",
    load: () => import("@/app/api/restaurant/recipes/price-catalog/route"),
    method: "POST",
    request: () => form("recipes/price-catalog"),
  },
  {
    name: "price-catalog/conflicts/[id] POST",
    load: () =>
      import("@/app/api/restaurant/recipes/price-catalog/conflicts/[id]/route"),
    method: "POST",
    request: () =>
      json(`recipes/price-catalog/conflicts/${ID}`, "POST", { choice: "none" }),
  },
  {
    name: "costs/batches/[id]/undo POST",
    load: () => import("@/app/api/restaurant/costs/batches/[id]/undo/route"),
    method: "POST",
    request: () => json(`costs/batches/${ID}/undo`, "POST"),
  },
  {
    name: "suppliers POST",
    load: () => import("@/app/api/restaurant/suppliers/route"),
    method: "POST",
    request: () => json("suppliers", "POST", { name: "Proveedor" }),
  },
  {
    name: "suppliers/[id] PATCH",
    load: () => import("@/app/api/restaurant/suppliers/[id]/route"),
    method: "PATCH",
    request: () => json(`suppliers/${ID}`, "PATCH", { name: "Otro" }),
  },
  {
    name: "suppliers/[id] DELETE",
    load: () => import("@/app/api/restaurant/suppliers/[id]/route"),
    method: "DELETE",
    request: () => json(`suppliers/${ID}`, "DELETE"),
  },
  {
    name: "invoices POST",
    load: () => import("@/app/api/restaurant/invoices/route"),
    method: "POST",
    request: () => json("invoices", "POST", {}),
  },
  {
    name: "invoices/[id]/approve POST",
    load: () => import("@/app/api/restaurant/invoices/[id]/approve/route"),
    method: "POST",
    request: () => json(`invoices/${ID}/approve`, "POST"),
  },
  {
    name: "invoices/[id]/lines POST",
    load: () => import("@/app/api/restaurant/invoices/[id]/lines/route"),
    method: "POST",
    request: () => json(`invoices/${ID}/lines`, "POST", {}),
  },
  {
    name: "invoices/from-extraction POST",
    load: () => import("@/app/api/restaurant/invoices/from-extraction/route"),
    method: "POST",
    request: () => json("invoices/from-extraction", "POST", {}),
  },
  {
    name: "invoices/extract POST",
    load: () => import("@/app/api/restaurant/invoices/extract/route"),
    method: "POST",
    request: () => form("invoices/extract"),
  },
  {
    name: "invoices/upload POST",
    load: () => import("@/app/api/restaurant/invoices/upload/route"),
    method: "POST",
    request: () => form("invoices/upload"),
  },
];

async function call(
  c: Case
): Promise<{ res: Response | "threw"; req: NextRequest }> {
  const mod = await c.load();
  const req = c.request();
  try {
    const res = await (mod[c.method] as Handler)(req, ctx);
    return { res, req };
  } catch {
    // Past the check the in-memory database is not enough: an allow here.
    return { res: "threw", req };
  }
}

beforeEach(() => {
  world.role = "owner";
  world.staff = false;
  world.dbTouches = 0;
  world.openaiCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("prices write routes need prices.edit", () => {
  for (const c of CASES) {
    it(`${c.name}: owner, admin, manager and Milton staff pass the check`, async () => {
      for (const role of ["owner", "admin", "manager"]) {
        world.role = role;
        const { res } = await call(c);
        expect(res === "threw" || res.status !== 403, role).toBe(true);
      }
      world.role = null;
      world.staff = true;
      const { res } = await call(c);
      expect(res === "threw" || res.status !== 403, "staff").toBe(true);
    });

    it(`${c.name}: member, viewer, analyst and no membership get the Spanish 403 and nothing runs`, async () => {
      for (const role of ["member", "viewer", "analyst", null]) {
        world.role = role;
        world.dbTouches = 0;
        world.openaiCalls = 0;
        const { res, req } = await call(c);
        expect(res, String(role)).not.toBe("threw");
        const response = res as Response;
        expect(response.status, String(role)).toBe(403);
        expect(((await response.json()) as { error: string }).error).toBe(
          MESSAGE
        );
        expect(world.dbTouches, `${role}: route db`).toBe(0);
        expect(world.openaiCalls, `${role}: openai`).toBe(0);
        expect(req.bodyUsed, `${role}: body untouched`).toBe(false);
      }
    });
  }
});
