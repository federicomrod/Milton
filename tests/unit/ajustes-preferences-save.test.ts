// Ajustes › «Preferencias regionales y de formato» → Guardar failed with
// «No pudimos guardar tus cambios» because it upserted timezone / currency /
// date_format / number_format / theme into `profiles`, which has none of
// those columns (001_baseline.sql). Preferences now live in the Auth user
// metadata; currency comes from the company's data. Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const state = vi.hoisted(() => ({
  user: null as null | { id: string; user_metadata: Record<string, unknown> },
  updateUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: state.updateUser,
    },
    from: state.from,
  }),
}));

import {
  CompanySaveError,
  getUserProfile,
  saveUserPreferences,
  updateCompany,
} from "@/lib/profile-service";

beforeEach(() => {
  state.user = {
    id: "u1",
    user_metadata: {
      preferences: { theme: "dark", date_format: "MM/DD/YYYY" },
    },
  };
  state.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  state.from.mockReset().mockImplementation(() => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "upsert"]) q[m] = () => q;
    q.maybeSingle = async () => ({
      data: { id: "u1", user_id: "u1" },
      error: null,
    });
    q.single = q.maybeSingle;
    return q;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("saving Ajustes preferences", () => {
  it("writes to the Auth user metadata, never to profiles", async () => {
    await saveUserPreferences({
      timezone: "America/El_Salvador",
      currency: "EUR",
      date_format: "DD/MM/YYYY",
      number_format: "1,000.00",
      theme: "light",
    });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.updateUser).toHaveBeenCalledWith({
      data: {
        preferences: {
          timezone: "America/El_Salvador",
          date_format: "DD/MM/YYYY",
          number_format: "1,000.00",
          theme: "light",
        },
      },
    });
  });

  it("keeps earlier saved preferences it was not asked to change", async () => {
    await saveUserPreferences({ timezone: "America/El_Salvador" });
    expect(state.updateUser.mock.calls[0][0].data.preferences).toEqual({
      theme: "dark",
      date_format: "MM/DD/YYYY",
      timezone: "America/El_Salvador",
    });
  });

  it("surfaces a real error instead of pretending it saved", async () => {
    state.updateUser.mockResolvedValue({
      data: null,
      error: new Error("network"),
    });
    await expect(saveUserPreferences({ theme: "light" })).rejects.toThrow();
  });

  it("reads saved preferences back from the metadata", async () => {
    const profile = await getUserProfile();
    expect(profile?.theme).toBe("dark");
    expect(profile?.date_format).toBe("MM/DD/YYYY");
    expect(profile?.currency).toBeUndefined();
  });

  it("no code path writes preference columns into profiles", () => {
    const src = read("lib/profile-service.ts");
    expect(src).not.toMatch(/from\("profiles"\)\s*\.upsert/);
    const ctx = read("lib/context/UserPreferencesContext.tsx");
    expect(ctx).not.toMatch(/currency, date_format, number_format/);
    expect(ctx).not.toContain('table: "profiles"');
  });
});

describe("company name on Ajustes", () => {
  it("a refused rename says why, not a vague database error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "Tu rol no puede cambiar la empresa." }),
      }))
    );
    await expect(updateCompany({ name: "Demo Resto" })).rejects.toBeInstanceOf(
      CompanySaveError
    );
    expect(state.from).not.toHaveBeenCalled();
  });

  it("Ajustes only renames when the name actually changed", () => {
    const page = read("app/dashboard/settings/page.tsx");
    expect(page).toContain("nameChanged ? updateCompany(companyForm)");
    expect(page).toContain("saveUserPreferences(form)");
    expect(page).not.toContain("upsertUserProfile");
  });
});

describe("Moneda shows the company's currency, never a made-up EUR", () => {
  it("Ajustes and Cuenta have no EUR fallback", () => {
    const page = read("app/dashboard/settings/page.tsx");
    expect(page).not.toMatch(/currency:\s*"EUR"/);
    expect(page).not.toMatch(/\|\| "EUR"/);
    expect(page).toContain("companyCurrency");
    const account = read("app/dashboard/account/page.tsx");
    expect(account).not.toMatch(/\|\| "EUR"/);
  });
  it("the company API returns the derived currency", () => {
    const route = read("app/api/restaurant/company/route.ts");
    expect(route).toContain(
      "resolveCompanyCurrency(auth.supabase, auth.companyId)"
    );
  });
});

describe("Ajustes hides preferences nothing uses yet", () => {
  const page = () => read("app/dashboard/settings/page.tsx");
  it("no Zona horaria, Formato de fecha or Formato de número fields", () => {
    expect(page()).not.toContain('htmlFor="timezone"');
    expect(page()).not.toContain('htmlFor="date_format"');
    expect(page()).not.toContain('htmlFor="number_format"');
    expect(page()).not.toContain("Preferencias regionales");
  });
  it("still keeps and saves the stored values, so they can come back", () => {
    expect(page()).toContain("timezone: profile.timezone");
    expect(page()).toContain("date_format: profile.date_format");
    expect(page()).toContain("number_format: profile.number_format");
    expect(page()).toContain("saveUserPreferences(form)");
  });
  it("Tema stays editable; Moneda and Industria are read-only", () => {
    expect(page()).toContain('htmlFor="theme"');
    expect(page()).toContain('handleChange("theme"');
    expect(page()).toMatch(/id="currency"\s+aria-readonly="true"/);
    expect(page()).toMatch(/id="industry"\s+aria-readonly="true"/);
    expect(page()).not.toContain("industry: e.target.value");
  });
  it("Cuenta no longer repeats the preferences", () => {
    const account = read("app/dashboard/account/page.tsx");
    for (const label of [
      "Zona horaria",
      "Formato de fecha",
      "Formato de número",
      "Moneda",
      ">\n                  Tema",
    ]) {
      expect(account).not.toContain(label);
    }
  });
  it("the dead profiles.role readers are gone", () => {
    const src = read("lib/profile-service.ts");
    expect(src).not.toContain("isUserAdmin(");
    expect(src).not.toContain("getUserRole(");
    expect(src).not.toMatch(/select\("role"\)/);
  });
});
