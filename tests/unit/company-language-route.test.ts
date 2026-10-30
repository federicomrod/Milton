// PATCH /api/restaurant/company: {name} keeps working; {preferred_language}
// saves the app language ("en" | "es" | "de") behind the same company.edit
// capability. Synthetic data only.
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n";

const state = vi.hoisted(() => ({
  allowed: true,
  updates: [] as Array<Record<string, unknown>>,
  dbError: false,
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    companyId: "company-a",
    userId: "user-1",
    supabase: {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload);
          const row = state.dbError ? null : { id: "company-a", ...payload };
          const chain = {
            eq: () => chain,
            select: () => chain,
            maybeSingle: async () => ({
              data: row,
              error: state.dbError ? { message: "x" } : null,
            }),
          };
          return chain;
        },
      }),
    },
  }),
}));
vi.mock("@/lib/auth/permissions", () => ({
  resolveActor: async () => ({}),
  requireCapability: () =>
    state.allowed ? null : NextResponse.json({ error: "no" }, { status: 403 }),
}));
vi.mock("@/lib/restaurant/api-lang", async () => {
  const { getDictionary: get } = await import("@/lib/i18n");
  return { apiDictionary: async () => get("es") };
});
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "MXN",
}));

function patch(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/restaurant/company", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/restaurant/company", () => {
  beforeEach(() => {
    state.allowed = true;
    state.updates = [];
    state.dbError = false;
  });

  it("still renames with {name}", async () => {
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({ name: "  Casa Centro " }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ name: "Casa Centro" });
    expect(state.updates[0]).not.toHaveProperty("preferred_language");
  });

  it("rejects an empty name when no language is sent", async () => {
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      getDictionary("es").errors.company.nameRequired
    );
  });

  it.each(["en", "es", "de"])("saves preferred_language %s", async (lang) => {
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({ preferred_language: lang }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ preferred_language: lang });
    expect(state.updates[0]).not.toHaveProperty("name");
  });

  it("rejects an unknown language without writing", async () => {
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({ preferred_language: "fr" }));
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("needs company.edit for the language too", async () => {
    state.allowed = false;
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({ preferred_language: "de" }));
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("answers 400 when the save fails", async () => {
    state.dbError = true;
    const { PATCH } = await import("@/app/api/restaurant/company/route");
    const res = await PATCH(patch({ preferred_language: "de" }));
    expect(res.status).toBe(400);
  });
});
