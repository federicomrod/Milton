// The one permissions table: who may do what, and which company counts.
// Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;
const { store, isUserAdminServer } = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  isUserAdminServer: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeDb(store),
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: (...a: unknown[]) => isUserAdminServer(...a),
}));

import {
  CAPABILITIES,
  can,
  capabilityFlags,
  normalizeRole,
  type Actor,
  type Capability,
} from "@/lib/auth/capabilities";
import {
  requireCapability,
  requireMiltonStaff,
  resolveActor,
} from "@/lib/auth/permissions";

const actor = (role: string | null, staff = false): Actor => ({
  userId: "u",
  companyId: "c",
  role,
  isMiltonStaff: staff,
});

// What each role could do before this helper existed (the rules were copied
// from the old scattered checks): [owner, admin, manager, member, viewer, none].
const EXPECTED: Record<Capability, boolean[]> = {
  "recipes.edit": [true, true, true, false, false, false],
  "recipes.submit": [true, true, true, false, false, false],
  "recipes.approve": [true, true, false, false, false, false],
  "prices.edit": [true, true, true, false, false, false],
  "links.confirm": [true, true, true, false, false, false],
  "ingredients.manage": [true, true, true, false, false, false],
  "menu.manage": [true, true, true, false, false, false],
  "groups.manage": [true, true, true, false, false, false],
  "locations.archive": [true, true, true, false, false, false],
  "targets.edit": [true, true, true, false, false, false],
  "shifts.edit": [true, true, true, false, false, false],
  "kitchen.drafts": [true, true, true, false, false, false],
  "kitchen.qr": [true, false, false, false, false, false],
  "costs.reset": [true, true, false, false, false, false],
  "costs.fixed": [true, true, true, false, false, false],
  "odoo.sync": [false, false, false, false, false, false],
  "odoo.diagnostics": [true, true, false, false, false, false],
  "imports.run": [true, true, true, false, false, false],
  "company.edit": [true, true, false, false, false, false],
  "team.manage": [true, false, false, false, false, false],
};
const ROLES = ["owner", "admin", "manager", "member", "viewer", null];

describe("CAPABILITIES × roles", () => {
  it("covers every capability in the table", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      Object.keys(CAPABILITIES).sort()
    );
  });

  for (const capability of Object.keys(EXPECTED) as Capability[]) {
    it(`${capability}`, () => {
      ROLES.forEach((role, i) => {
        expect(can(actor(role), capability), `${capability} / ${role}`).toBe(
          EXPECTED[capability][i]
        );
      });
    });
  }

  it("Milton staff pass everything except the company reset", () => {
    for (const capability of Object.keys(EXPECTED) as Capability[]) {
      expect(can(actor(null, true), capability), capability).toBe(
        capability !== "costs.reset"
      );
    }
  });

  it("«Owner» and « owner » are owner; an unknown role has no permission", () => {
    for (const role of ["Owner", " owner ", "OWNER"]) {
      expect(can(actor(role), "kitchen.qr"), role).toBe(true);
      expect(normalizeRole(role)).toBe("owner");
    }
    expect(can(actor("superboss"), "recipes.edit")).toBe(false);
    expect(can(actor("analyst"), "recipes.edit")).toBe(false);
  });

  it("capabilityFlags is the same answer as can(), for the client", () => {
    const flags = capabilityFlags(actor(" Manager "));
    expect(flags["recipes.edit"]).toBe(true);
    expect(flags["recipes.approve"]).toBe(false);
    expect(flags["kitchen.qr"]).toBe(false);
  });
});

describe("requireCapability / requireMiltonStaff", () => {
  it("null when allowed; otherwise a 403 in Spanish (default and per-capability)", async () => {
    expect(requireCapability(actor("owner"), "recipes.edit")).toBeNull();
    const edit = requireCapability(actor("viewer"), "recipes.edit")!;
    expect(edit.status).toBe(403);
    expect((await edit.json()).error).toBe("Tu rol no puede editar recetas.");
    const approve = requireCapability(actor("manager"), "recipes.approve")!;
    expect((await approve.json()).error).toBe(
      "Tu rol no puede aprobar recetas."
    );
    const price = requireCapability(actor(null), "prices.edit")!;
    expect((await price.json()).error).toBe("Tu rol no puede cambiar precios.");
    const link = requireCapability(actor(null), "links.confirm")!;
    expect((await link.json()).error).toBe(
      "Tu rol no puede vincular productos."
    );
    const dflt = requireCapability(actor("member"), "kitchen.qr")!;
    expect((await dflt.json()).error).toBe(
      "No tienes permiso para cambiar esto."
    );
    const custom = requireCapability(actor("member"), "kitchen.qr", {
      message: "Otro mensaje.",
    })!;
    expect((await custom.json()).error).toBe("Otro mensaje.");
  });

  it("Milton-staff-only endpoints answer a Spanish 403 to everyone else", async () => {
    isUserAdminServer.mockResolvedValue(false);
    const denied = (await requireMiltonStaff("u"))!;
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe(
      "No tienes permiso para cambiar esto."
    );
    isUserAdminServer.mockResolvedValue(true);
    expect(await requireMiltonStaff("u")).toBeNull();
  });
});

describe("resolveActor: the role of THE company in question", () => {
  beforeEach(() => {
    isUserAdminServer.mockResolvedValue(false);
    Object.assign(store, {
      company_memberships: [
        {
          user_id: "fede",
          company_id: "A",
          role: "member",
          created_at: "2026-01-01",
        },
        {
          user_id: "fede",
          company_id: "B",
          role: " Owner ",
          created_at: "2026-02-01",
        },
        {
          user_id: "ana",
          company_id: "A",
          role: "viewer",
          created_at: "2026-01-01",
        },
      ],
      profiles: [{ id: "fede", company_id: "B" }],
    });
  });

  const userDb = () => makeFakeDb(store) as never;

  it("with no company given, uses the user's own (profile on B → B) and reads the role there", async () => {
    const a = await resolveActor(userDb(), "fede");
    expect(a.companyId).toBe("B");
    expect(a.role).toBe("owner");
    expect(can(a, "recipes.edit")).toBe(true);
    expect(can(a, "prices.edit")).toBe(true);
    expect(can(a, "links.confirm")).toBe(true);
    expect(can(a, "kitchen.drafts")).toBe(true);
  });

  it("a resource of company A: the same person is only a member there, so 403 in Spanish", async () => {
    const a = await resolveActor(userDb(), "fede", { companyId: "A" });
    expect(a.role).toBe("member");
    for (const cap of [
      "recipes.edit",
      "prices.edit",
      "links.confirm",
      "kitchen.drafts",
    ] as Capability[]) {
      const denied = requireCapability(a, cap)!;
      expect(denied.status, cap).toBe(403);
      expect(typeof (await denied.json()).error).toBe("string");
    }
  });

  it("a company the person has no membership in: no role, nothing allowed", async () => {
    const a = await resolveActor(userDb(), "ana", { companyId: "B" });
    expect(a.role).toBeNull();
    expect(can(a, "recipes.edit")).toBe(false);
    expect(capabilityFlags(a)["kitchen.drafts"]).toBe(false);
  });

  it("Milton staff keep passing in a company they are not a member of", async () => {
    isUserAdminServer.mockResolvedValue(true);
    const a = await resolveActor(userDb(), "ana", { companyId: "B" });
    expect(a.role).toBeNull();
    expect(can(a, "recipes.edit")).toBe(true);
  });
});
