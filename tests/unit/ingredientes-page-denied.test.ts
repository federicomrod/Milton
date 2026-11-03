// A kitchen role that opens Menú › Ingredientes is redirected on the server and
// nothing is read for it. Demo data only.
import { beforeEach, describe, expect, it, vi } from "vitest";

let role: string | null = "member";
const fetchCosts = vi.fn(async () => []);
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("@/lib/restaurant/shell-context-server", () => ({
  loadRestaurantShellChrome: async () => ({ lang: "es" }),
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1" }),
  getCachedCompanyId: async () => "co-1",
  getCachedActor: async () => ({
    userId: "u1",
    companyId: "co-1",
    role,
    isMiltonStaff: false,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("must not be read for a cook");
  },
}));
vi.mock("@/lib/restaurant/menu-recipes-server", () => ({
  fetchIngredientLatestCosts: () => fetchCosts(),
}));

import IngredientesRoute from "@/app/dashboard/restaurant/menu/ingredientes/page";

beforeEach(() => {
  fetchCosts.mockClear();
  redirect.mockClear();
});

describe("Ingredientes page", () => {
  it.each(["member", null])(
    "%s: redirected to Menú, no data read",
    async (r) => {
      role = r;
      await expect(
        IngredientesRoute({ searchParams: Promise.resolve({}) })
      ).rejects.toThrow("NEXT_REDIRECT /dashboard/restaurant/menu");
      expect(fetchCosts).not.toHaveBeenCalled();
    }
  );
});
