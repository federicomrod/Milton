// Faster navigation: every restaurant route has an instant skeleton, the shell
// layout reads in parallel, and the membership lookup is shared per request.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("every route has a skeleton", () => {
  const routes = [
    "app/dashboard/restaurant/rentabilidad",
    "app/dashboard/restaurant/briefing",
    "app/dashboard/restaurant/agents",
    "app/dashboard/restaurant/invoices",
    "app/dashboard/restaurant/suppliers",
    "app/dashboard/restaurant/ingredients",
    "app/dashboard/restaurant/upload",
    "app/dashboard/restaurant/connect-data",
    "app/dashboard/restaurant/components/[id]",
    "app/dashboard/settings",
    "app/dashboard/account",
    // already had one
    "app/dashboard/restaurant/(cockpit)",
    "app/dashboard/restaurant/sales",
    "app/dashboard/restaurant/costs",
    "app/dashboard/restaurant/menu",
    "app/dashboard/restaurant/kitchen",
    "app/dashboard/restaurant/data",
  ];
  it.each(routes)("%s/loading.tsx exists", (dir) => {
    expect(existsSync(join(process.cwd(), dir, "loading.tsx"))).toBe(true);
  });
  it("the shared skeletons render placeholders and no text of the page", async () => {
    const { ListPageSkeleton, RentabilidadSkeleton } =
      await import("@/components/restaurant/shell/RouteSkeletons");
    for (const el of [
      <ListPageSkeleton key="a" />,
      <RentabilidadSkeleton key="b" />,
    ]) {
      const html = renderToStaticMarkup(el);
      expect(html).toContain('data-testid="route-skeleton"');
      expect(html).toContain('aria-busy="true"');
      expect(html).not.toMatch(/\$|Sin precio/);
    }
  });
});

describe("the shell layout does not wait twice", () => {
  const src = read("components/restaurant/RestaurantShellLayout.tsx");
  it("reads chrome and capabilities together", () => {
    expect(src).toMatch(/Promise\.all\(\[\s*loadRestaurantShellChrome\(\)/);
    expect(src).not.toContain("resolveActor");
  });
});

describe("the membership lookup is shared per request", () => {
  it("pages use getCachedActor, not resolveActor", () => {
    for (const f of [
      "app/dashboard/restaurant/rentabilidad/page.tsx",
      "app/dashboard/restaurant/costs/page.tsx",
      "app/dashboard/restaurant/menu/ingredientes/page.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("getCachedActor");
      expect(src, f).not.toContain("resolveActor(");
    }
  });
  it("resolveActor can take an already-known staff flag (one RPC, not two)", async () => {
    const isUserAdminServer = vi.fn(async () => true);
    vi.resetModules();
    vi.doMock("@/lib/profile-service-server", () => ({ isUserAdminServer }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { role: " Owner " },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }));
    const { resolveActor } = await import("@/lib/auth/permissions");
    const actor = await resolveActor(null, "u1", {
      companyId: "c1",
      isMiltonStaff: false,
    });
    expect(actor).toMatchObject({ role: "owner", isMiltonStaff: false });
    expect(isUserAdminServer).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/profile-service-server");
    vi.doUnmock("@/lib/supabase/admin");
  });
});

describe("Costos fijos starts independent reads together", () => {
  it("margin, split and the monthly copy run in one Promise.all", () => {
    const src = read("app/dashboard/restaurant/costs/page.tsx");
    expect(src).toMatch(
      /Promise\.all\(\[\s*repeated,\s*splitSalesP,\s*loadMonthMargin/
    );
    expect(src).toContain("<Suspense");
  });
});
