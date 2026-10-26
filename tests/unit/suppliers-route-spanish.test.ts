// Supplier routes answer in Spanish; status codes and `details` are unchanged.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authAndCompany, insertResult } = vi.hoisted(() => ({
  authAndCompany: vi.fn(),
  insertResult: { current: null as unknown },
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...a: unknown[]) => authAndCompany(...a),
}));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    resolveActor: async () => ({
      userId: "u1",
      companyId: "co-1",
      role: "owner",
      isMiltonStaff: false,
    }),
  };
});

import { POST } from "@/app/api/restaurant/suppliers/route";

const insertChain = () => ({
  insert: () => ({
    select: () => ({ single: async () => insertResult.current }),
  }),
});

beforeEach(() => {
  insertResult.current = { data: null, error: null };
  authAndCompany.mockResolvedValue({
    ok: true,
    userId: "u1",
    companyId: "co-1",
    supabase: { from: () => insertChain() },
  });
});

const post = (body: unknown, raw?: string) =>
  POST(
    new NextRequest("http://localhost/api/restaurant/suppliers", {
      method: "POST",
      body: raw ?? JSON.stringify(body),
    })
  );

describe("POST /api/restaurant/suppliers · Spanish errors", () => {
  it("a duplicate name is 409 «Ya existe un proveedor con ese nombre.»", async () => {
    insertResult.current = {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    };
    const res = await post({ name: "Proveedor Uno" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Ya existe un proveedor con ese nombre."
    );
  });
  it("name required and body must be JSON keep their 400", async () => {
    const noName = await post({ name: "  " });
    expect(noName.status).toBe(400);
    expect((await noName.json()).error).toBe("El nombre es obligatorio.");
    const bad = await post(null, "{not json");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(
      "El cuerpo de la solicitud debe ser JSON."
    );
  });
  it("another failure is 500 «No pude crear…» and keeps `details`", async () => {
    insertResult.current = {
      data: null,
      error: { code: "XX000", message: "boom" },
    };
    const res = await post({ name: "Proveedor Dos" });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("No pude crear el proveedor. Inténtalo de nuevo.");
    expect(json.details).toBe("boom");
  });
});

describe("no English left in the supplier routes' user-visible errors", () => {
  it("the source has none of the old strings", async () => {
    const { readFileSync } = await import("fs");
    const files = [
      "app/api/restaurant/suppliers/route.ts",
      "app/api/restaurant/suppliers/[id]/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const old of [
        "already exists",
        "is required",
        "Body must be JSON",
        "Nothing to update",
        "Update failed",
        "Archive failed",
        "Create failed",
        "Read failed",
      ]) {
        expect(src).not.toContain(old);
      }
    }
  });
});
