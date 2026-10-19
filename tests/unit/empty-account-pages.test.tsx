// A brand-new account (signed up, onboarding done: no restaurants, POS, ingredients,
// costs, suppliers or invoices) must see a friendly empty state on every main page,
// never the white «Application error» screen. Made-up data only: the database is a
// fake whose every query comes back empty (or failing, or null).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---- the fake database: every query is empty / failing / null ----
const MODE = { error: false, nullData: false };
function query(): unknown {
  const result = MODE.error
    ? {
        data: null,
        error: { message: "relation does not exist", code: "42P01" },
        count: null,
      }
    : MODE.nullData
      ? { data: null, error: null, count: null }
      : { data: [], error: null, count: 0 };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then")
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej);
      if (prop === "maybeSingle" || prop === "single")
        return () => Promise.resolve({ data: null, error: null });
      return () => new Proxy(function () {}, handler);
    },
  };
  return new Proxy(function () {}, handler);
}
const fake = () => ({
  from: () => query(),
  rpc: () =>
    Promise.resolve({
      data: null,
      error: { message: "no rpc", code: "42883" },
    }),
  auth: {
    getUser: async () => ({ data: { user: { id: "u1", email: "a@b.co" } } }),
  },
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake() }));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  // the role read: an empty account has no memberships
  createAdminClient: () => fake(),
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1", email: "a@b.co" }),
  getCachedCompanyId: async () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {
    throw new Error("redirect");
  },
}));
// the Menú-area profitability model: the real one, unless a test supplies its own
let menuModel: null | (() => unknown) = null;
vi.mock("@/lib/restaurant/cockpit-page-data", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    loadMenuAreaModel: (...a: unknown[]) =>
      menuModel
        ? menuModel()
        : (real.loadMenuAreaModel as (...x: unknown[]) => unknown)(...a),
  };
});

type El = { type?: unknown; props?: { children?: unknown } } | null;
/** Resolve async server components so the whole page can be rendered to a string. */
async function resolve(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 8 || !node || typeof node !== "object") return node;
  if (Array.isArray(node))
    return Promise.all(node.map((n) => resolve(n, depth)));
  const el = node as NonNullable<El>;
  if (
    typeof el.type === "function" &&
    (el.type as { constructor?: { name?: string } }).constructor?.name ===
      "AsyncFunction"
  ) {
    return resolve(
      await (el.type as (p: unknown) => unknown)(el.props),
      depth + 1
    );
  }
  if (el.props?.children)
    return {
      ...el,
      props: {
        ...el.props,
        children: await resolve(el.props.children, depth + 1),
      },
    };
  return node;
}
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

async function draw(path: string, sp: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ path);
  const element = await mod.default({
    searchParams: Promise.resolve(sp),
    params: Promise.resolve({}),
  });
  return renderToString((await resolve(element)) as never);
}

const PAGES: Array<[string, string, Record<string, string>]> = [
  ["Cockpit", "@/app/dashboard/restaurant/(cockpit)/page", {}],
  ["Ventas", "@/app/dashboard/restaurant/sales/page", {}],
  ["Menú › Resumen", "@/app/dashboard/restaurant/menu/page", {}],
  ["Menú › Platos", "@/app/dashboard/restaurant/menu/platos/page", {}],
  [
    "Menú › Ingredientes",
    "@/app/dashboard/restaurant/menu/ingredientes/page",
    {},
  ],
  [
    "Menú › Preparaciones",
    "@/app/dashboard/restaurant/menu/preparaciones/page",
    {},
  ],
  ["Costos › Cambios de precio", "@/app/dashboard/restaurant/costs/page", {}],
  [
    "Costos › Compras",
    "@/app/dashboard/restaurant/costs/page",
    { tab: "compras" },
  ],
  [
    "Costos › Proveedores",
    "@/app/dashboard/restaurant/costs/page",
    { tab: "proveedores" },
  ],
];
const FAKE_MONEY = /\$\s?0(?![.,\d])|MXN\s?0\b|MXN\s?\$/;

beforeEach(() => {
  MODE.error = false;
  MODE.nullData = false;
  menuModel = null;
});

describe("every main page renders for an empty account (no restaurant, POS, ingredients, costs, suppliers, invoices)", () => {
  for (const [name, path, sp] of PAGES) {
    it(`${name}: no throw, no $0 / MXN 0`, async () => {
      const html = await draw(path, sp);
      expect(html.length).toBeGreaterThan(200);
      expect(
        FAKE_MONEY.test(text(html)),
        `${name}: ${text(html).match(FAKE_MONEY)?.[0]}`
      ).toBe(false);
    });
  }
  for (const [mode, flags] of [
    ["failing reads", { error: true, nullData: false }],
    ["null results", { error: false, nullData: true }],
  ] as const) {
    it(`and when every read ${mode === "failing reads" ? "fails" : "comes back null"} they still render`, async () => {
      MODE.error = flags.error;
      MODE.nullData = flags.nullData;
      for (const [name, path, sp] of PAGES) {
        const html = await draw(path, sp).catch((e: unknown) => {
          throw new Error(
            `${name} threw: ${e instanceof Error ? e.message : e}`
          );
        });
        expect(html.length, name).toBeGreaterThan(20);
        expect(FAKE_MONEY.test(text(html)), name).toBe(false);
      }
    });
  }

  it("Costos says how to start and offers the upload; the KPIs show «—» / «Sin precio», never $0", async () => {
    const t = text(await draw("@/app/dashboard/restaurant/costs/page"));
    expect(t).toContain(
      "Aún no tienes costos. Sube un archivo de costos o una factura para empezar."
    );
    expect(t).toContain("Subir archivo de costos");
    expect(t).toContain("Subir factura");
    expect(t).toContain("Sin precio");
    expect(t).toContain("—");
    expect(t).not.toContain("MXN");
  });
  it("Menú › Resumen says there are no dishes yet instead of a screen of $0", async () => {
    const t = text(await draw("@/app/dashboard/restaurant/menu/page"));
    expect(t).toContain("Aún no tienes platos.");
    expect(t).toContain("Conecta tu POS");
    expect(t).toContain("Sube tus costos");
  });
  it("Cockpit shows the empty Cockpit v2 («Sin datos aún»), no sample numbers", async () => {
    const t = text(await draw("@/app/dashboard/restaurant/(cockpit)/page"));
    expect(t).toContain("Sin datos aún");
    expect(t).toContain("Conecta tu POS");
    expect(t).not.toMatch(/BBQ|Rentabilidad por platillo|397/);
  });
});

describe("Costos with a partial `profitability` (the unguarded toFixed)", () => {
  it("cost_coverage_pct null / undefined / NaN and empty arrays render, with no invented percentage", async () => {
    for (const coverage of [null, undefined, Number.NaN]) {
      menuModel = () => ({
        profitability: {
          kpis: {
            revenue_total: 1000,
            cost_coverage_pct: coverage,
            food_cost_pct: null,
            currency: "USD",
          },
          ingredientPriceTrends: [],
          topSupplierSpend: [],
          setupCounts: {},
        },
      });
      const t = text(await draw("@/app/dashboard/restaurant/costs/page"));
      expect(t).toContain("Costo de comida");
      expect(t).toContain("Aún sin ventas");
      expect(t).not.toMatch(/NaN|undefined|null/);
    }
  });
  it("a profitability object missing whole branches (no setupCounts, trends, spend, kpis) does not throw", async () => {
    menuModel = () => ({ profitability: {} });
    expect(text(await draw("@/app/dashboard/restaurant/costs/page"))).toContain(
      "Costos"
    );
    menuModel = () => ({
      profitability: { kpis: undefined, ingredientPriceTrends: null },
    });
    expect(text(await draw("@/app/dashboard/restaurant/costs/page"))).toContain(
      "Costos"
    );
  });
  it("sales with an unknown cost coverage show the coverage as a real percentage once it is known", async () => {
    menuModel = () => ({
      profitability: {
        kpis: {
          revenue_total: 1000,
          cost_coverage_pct: 42.4,
          food_cost_pct: 31.2,
          currency: "USD",
        },
        ingredientPriceTrends: [],
        topSupplierSpend: [],
        setupCounts: { ingredients_count: 3 },
      },
    });
    const t = text(await draw("@/app/dashboard/restaurant/costs/page"));
    expect(t).toContain("42% de las ventas con costo");
    expect(t).toContain("31.2%");
    expect(t).not.toContain("Aún no tienes costos");
  });
});

describe("the loaders never throw", () => {
  it("Compras / Proveedores return an empty result (not null, not an exception) when a read throws", async () => {
    const m = await import("@/lib/restaurant/costs-page-data");
    MODE.error = true;
    const inv = await m.loadInvoicesTabData();
    expect(inv).not.toBeNull();
    expect(inv?.invoices).toEqual([]);
    expect(await m.loadSuppliersTabData()).toEqual([]);
  });
  it("the recipe workspace load answers ok:false instead of throwing", async () => {
    const { loadRecipeCostingWorkspace } =
      await import("@/lib/restaurant/recipe-costing/workspace-server");
    MODE.error = true;
    const r = await loadRecipeCostingWorkspace(fake() as never, {
      companyId: "11111111-1111-4111-8111-111111111111",
      userId: "u1",
      view: "resumen",
    });
    expect(r.ok).toBe(false);
  });
});

describe("error boundaries: a future error never shows the white Next.js screen", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the restaurant routes (the Cockpit included) have an error.tsx with «Reintentar»", async () => {
    for (const f of ["app/dashboard/restaurant/error.tsx"]) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(true);
      const src = read(f);
      expect(src).toContain('"use client"');
      expect(src).toContain("RouteError");
    }
    const { RouteError } =
      await import("@/components/restaurant/shell/RouteError");
    const { createElement } = await import("react");
    const html = renderToString(
      createElement(RouteError, {
        error: Object.assign(new Error("x"), { digest: "abc123" }),
        reset() {},
      })
    );
    const t = text(html);
    expect(t).toContain("Algo salió mal");
    expect(t).toContain("Reintentar");
    expect(t).toContain("abc123");
    expect(html).toContain('role="alert"');
  });
  it("they sit under the layouts that render the sidebar (so it stays)", () => {
    expect(
      existsSync(join(process.cwd(), "app/dashboard/restaurant/layout.tsx"))
    ).toBe(true);
    // ONE layout for every /dashboard/restaurant page: the Cockpit no longer has its own
    expect(
      existsSync(join(process.cwd(), "app/(restaurant-cockpit)/layout.tsx"))
    ).toBe(false);
    expect(
      existsSync(
        join(process.cwd(), "app/dashboard/restaurant/(cockpit)/page.tsx")
      )
    ).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), "app/dashboard/restaurant/(cockpit)/loading.tsx")
      )
    ).toBe(true);
  });
});
