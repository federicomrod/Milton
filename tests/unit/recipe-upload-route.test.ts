// POST /api/restaurant/kitchen/recipe-upload: permission first, company from
// the session only, location of that company, size and type errors, the admin
// client only after the guard, and no extracted text in the answer.
// Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const BIG_MESSAGE =
  "Este archivo pesa más de 4 MB. Divídelo en partes o sube las páginas como fotos.";
const DOC_MESSAGE =
  "Los archivos .doc antiguos no se pueden leer. Guárdalo como .docx y vuelve a subirlo.";

const store: FakeStore = {};
const authAndCompany = vi.fn();
const loadMembershipRole = vi.fn();
const isUserAdminServer = vi.fn();
const processRecipeFile = vi.fn();
const adminCreated = vi.fn();

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: (...a: unknown[]) => authAndCompany(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminCreated();
    return { __admin: true };
  },
}));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    resolveActor: async (
      _s: unknown,
      userId: string,
      opts?: { companyId?: string | null }
    ) => ({
      userId,
      companyId: opts?.companyId ?? null,
      role: actual.normalizeRole(
        await loadMembershipRole(opts?.companyId, userId)
      ),
      isMiltonStaff: Boolean(await isUserAdminServer(userId)),
    }),
  };
});
vi.mock("@/lib/restaurant/recipe-upload/process", () => ({
  MAX_UPLOAD_BYTES: 4 * 1024 * 1024,
  FILE_TOO_BIG_MESSAGE:
    "Este archivo pesa más de 4 MB. Divídelo en partes o sube las páginas como fotos.",
  detectUploadKind: (name: string) => {
    if (/\.doc$/i.test(name))
      return {
        ok: false,
        error:
          "Los archivos .doc antiguos no se pueden leer. Guárdalo como .docx y vuelve a subirlo.",
      };
    if (/\.(xlsx|csv|docx|pdf|png|jpe?g|webp)$/i.test(name))
      return { ok: true, kind: "xlsx" };
    return {
      ok: false,
      error:
        "Este tipo de archivo no se puede leer. Sube Excel, Word, PDF o una foto.",
    };
  },
  processRecipeFile: (...a: unknown[]) => processRecipeFile(...a),
}));

import { POST } from "@/app/api/restaurant/kitchen/recipe-upload/route";

function req(
  file: File | null,
  extra: Record<string, string> = {}
): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new NextRequest(
    "http://localhost/api/restaurant/kitchen/recipe-upload",
    {
      method: "POST",
      body: form,
    }
  );
}
const sheet = () => new File(["x"], "recetas.xlsx");

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  store.restaurant_locations = [
    { id: "loc-b", company_id: "co-1", name: "Beta" },
    { id: "loc-a", company_id: "co-1", name: "Alfa" },
    { id: "loc-x", company_id: "co-2", name: "Otra empresa" },
  ];
  authAndCompany.mockResolvedValue({
    ok: true,
    supabase: makeFakeDb(store),
    companyId: "co-1",
    userId: "u-1",
  });
  loadMembershipRole.mockResolvedValue("owner");
  isUserAdminServer.mockResolvedValue(false);
  processRecipeFile.mockResolvedValue({
    file: "recetas.xlsx",
    recipes_found: 2,
    drafts_created: 2,
    duplicates: [],
    preparations: [],
    ignored_sections: [],
    lines_without_quantity: 0,
    errors: [],
  });
});

describe("who may upload", () => {
  it.each(["member", "viewer", "analyst"])(
    "%s gets the 403 copy",
    async (role) => {
      loadMembershipRole.mockResolvedValue(role);
      const res = await POST(req(sheet()));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(
        "No tienes permiso para cambiar esto."
      );
      expect(adminCreated).not.toHaveBeenCalled();
      expect(processRecipeFile).not.toHaveBeenCalled();
    }
  );

  it.each(["owner", "admin", "manager"])("%s is allowed", async (role) => {
    loadMembershipRole.mockResolvedValue(role);
    const res = await POST(req(sheet()));
    expect(res.status).toBe(200);
  });

  it("Milton staff is allowed", async () => {
    loadMembershipRole.mockResolvedValue("member");
    isUserAdminServer.mockResolvedValue(true);
    expect((await POST(req(sheet()))).status).toBe(200);
  });

  it("checks the permission before reading the body", async () => {
    loadMembershipRole.mockResolvedValue("viewer");
    const r = req(sheet());
    const spy = vi.spyOn(r, "formData");
    await POST(r);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an unauthenticated call stops at the auth answer", async () => {
    const { NextResponse } = await import("next/server");
    authAndCompany.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Inicia sesión de nuevo." },
        { status: 401 }
      ),
    });
    expect((await POST(req(sheet()))).status).toBe(401);
    expect(adminCreated).not.toHaveBeenCalled();
  });
});

describe("company and location", () => {
  it("uses the session's company and ignores a company_id in the form", async () => {
    await POST(req(sheet(), { company_id: "co-2", location_id: "loc-a" }));
    expect(processRecipeFile).toHaveBeenCalledTimes(1);
    const arg = processRecipeFile.mock.calls[0][0];
    expect(arg.companyId).toBe("co-1");
    expect(arg.locationId).toBe("loc-a");
    expect(arg.admin).toEqual({ __admin: true });
  });

  it("defaults to the company's first location (by name)", async () => {
    await POST(req(sheet()));
    expect(processRecipeFile.mock.calls[0][0].locationId).toBe("loc-a");
  });

  it("a location of another company is a 404", async () => {
    const res = await POST(req(sheet(), { location_id: "loc-x" }));
    expect(res.status).toBe(404);
    expect(processRecipeFile).not.toHaveBeenCalled();
    expect(adminCreated).not.toHaveBeenCalled();
  });
});

describe("the file", () => {
  it("over 4 MB is a 413 with the exact message", async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf");
    const res = await POST(req(big));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(BIG_MESSAGE);
    expect(processRecipeFile).not.toHaveBeenCalled();
  });

  it("an unsupported type is a 415 with the detector's message", async () => {
    const res = await POST(req(new File(["x"], "musica.mp3")));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toContain("Excel, Word, PDF o una foto");
  });

  it("an old .doc gets the .docx message", async () => {
    const res = await POST(req(new File(["x"], "viejo.doc")));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe(DOC_MESSAGE);
  });

  it("no file is a 400", async () => {
    expect((await POST(req(null))).status).toBe(400);
  });

  it("the answer is the result and never carries extracted text", async () => {
    processRecipeFile.mockResolvedValue({
      file: "recetas.xlsx",
      recipes_found: 1,
      drafts_created: 1,
      duplicates: [],
      preparations: [],
      ignored_sections: [],
      lines_without_quantity: 0,
      errors: [],
    });
    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: (() => {
          const f = new FormData();
          f.append("file", new File(["SECRETO-EN-EL-ARCHIVO"], "recetas.xlsx"));
          return f;
        })(),
      })
    );
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("SECRETO-EN-EL-ARCHIVO");
    expect(JSON.parse(text).drafts_created).toBe(1);
  });

  it("logs counts and timings only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await POST(req(new File(["x"], "Cliente Privado.xlsx")));
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    expect(
      lines.some((l) =>
        /^\[recipe-upload\] file processed recipes=2 drafts=2 ms=\d+$/.test(l)
      )
    ).toBe(true);
    expect(lines.join("\n")).not.toContain("Cliente Privado");
  });
});
