// Fix 2 (PR #192): saving "excluido" takes sales out of the coverage
// denominator, so it needs the recipe-approval roles. Exercises the real
// POST handler with auth and the actor mocked.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXCLUDE_CLIENT_CONFIRMATION_ERROR,
  EXCLUDE_ROLE_ERROR,
  TREATMENT_ROLE_ERROR,
} from "@/lib/restaurant/recipe-costing/link-actions-server";
import type { Row } from "./helpers/fake-links-supabase";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  actor: { user_id: "u-1", role: "owner", is_milton_staff: false } as {
    user_id: string;
    role: string | null;
    is_milton_staff: boolean;
  },
}));

vi.mock("@/lib/restaurant/api-auth", async () => {
  const { fakeLinksSupabase: fake } =
    await import("./helpers/fake-links-supabase");
  return {
    authAndCompany: async () => ({
      ok: true,
      supabase: fake(state.rows),
      companyId: "co-a",
      userId: state.actor.user_id,
    }),
  };
});

vi.mock("@/lib/restaurant/recipe-costing/actor-server", () => ({
  loadRecipeActor: async () => state.actor,
}));

import { POST } from "@/app/api/restaurant/pos/links/treatment/route";

function call(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/restaurant/pos/links/treatment", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );
}

const exclude = {
  items: [{ odoo_product_id: 5, odoo_name: "Camiseta", treatment: "excluido" }],
};
const dish = {
  items: [
    { odoo_product_id: 6, odoo_name: "Pollo", treatment: "plato_preparado" },
  ],
};

function as(role: string | null, staff = false) {
  state.actor = { user_id: "u-1", role, is_milton_staff: staff };
}

const saved = (id: number) =>
  state.rows.find((row: Row) => row.odoo_product_id === id)?.classification;

describe("treatment route — who may save excluido", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it("a manager cannot save excluido: 403, clear Spanish message, nothing saved", async () => {
    as("manager");
    const res = await call(exclude);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(EXCLUDE_ROLE_ERROR);
    expect(json.error).toMatch(/Solo el dueño o un admin/);
    expect(json.error).toMatch(/«no es comida»/);
    expect(state.rows).toHaveLength(0);
  });

  it("a mixed batch with one excluido is refused whole for a manager", async () => {
    as("manager");
    const res = await call({ items: [...dish.items, ...exclude.items] });
    expect(res.status).toBe(403);
    expect(state.rows).toHaveLength(0);
  });

  it("a manager can still save other treatments", async () => {
    as("manager");
    const res = await call(dish);
    expect(res.status).toBe(200);
    expect(saved(6)).toBe("plato_preparado");
  });

  it("owner and admin can save excluido", async () => {
    for (const role of ["owner", "admin"]) {
      state.rows = [];
      as(role);
      const res = await call(exclude);
      expect(res.status, role).toBe(200);
      expect(saved(5), role).toBe("excluido");
    }
  });

  it("Milton staff need the client's confirmation, like approving a recipe", async () => {
    as(null, true);
    const blocked = await call(exclude);
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: string }).error).toBe(
      EXCLUDE_CLIENT_CONFIRMATION_ERROR
    );
    expect(state.rows).toHaveLength(0);

    const ok = await call({ ...exclude, confirmed_how: "whatsapp" });
    expect(ok.status).toBe(200);
    const row = state.rows.find((r: Row) => r.odoo_product_id === 5)!;
    expect(row.classification).toBe("excluido");
    expect((row.evidence as Row).treatment).toMatchObject({
      confirmed_how: "whatsapp",
    });
  });

  it("a viewer still gets 403 for any treatment", async () => {
    as("viewer");
    for (const body of [dish, exclude]) {
      const res = await call(body);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe(
        TREATMENT_ROLE_ERROR
      );
    }
    expect(state.rows).toHaveLength(0);
  });
});
