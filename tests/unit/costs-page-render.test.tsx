// The Costos page rendered on the server (all three tabs), with an empty and with
// a populated made-up company: it must not throw, and the Compras KPI shows a
// formatted amount (populated) or «—» (empty). Regression: the page used to call
// formatMoney() imported from a "use client" module, which Next refuses at request
// time ("Attempted to call formatMoney() from the server").
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";

let TABLES: Record<string, unknown[]> = {};
function query(table: string): unknown {
  const rows = TABLES[table] ?? [];
  const result = { data: rows, error: null, count: rows.length };
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
  from: (table: string) => query(table),
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
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1", email: "a@b.co" }),
  getCachedCompanyId: async () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

type El = { type?: unknown; props?: { children?: unknown } } | null;
async function resolve(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 8 || !node || typeof node !== "object") return node;
  if (Array.isArray(node))
    return Promise.all(node.map((n) => resolve(n, depth)));
  const el = node as NonNullable<El>;
  if (
    typeof el.type === "function" &&
    (el.type as { constructor?: { name?: string } }).constructor?.name ===
      "AsyncFunction"
  )
    return resolve(
      await (el.type as (p: unknown) => unknown)(el.props),
      depth + 1
    );
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
async function drawCosts(tab?: string) {
  const mod = await import("@/app/dashboard/restaurant/costs/page");
  const element = await mod.default({
    searchParams: Promise.resolve(tab ? { tab } : {}),
  });
  return text(renderToString((await resolve(element)) as never));
}

const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const POPULATED = () => ({
  restaurant_locations: [{ id: "r1", name: "Local de prueba" }],
  suppliers: [{ id: "s1", name: "Proveedor de prueba", status: "active" }],
  ingredients: [
    { id: "i1", name: "Ingrediente de prueba", default_unit: "lb" },
  ],
  ingredient_cost_entries: [
    {
      cost_date: isoDaysAgo(3),
      total_cost: 1234,
      currency: "USD",
      supplier_id: "s1",
      ingredient_id: "i1",
    },
    {
      cost_date: isoDaysAgo(40),
      total_cost: 1000,
      currency: "USD",
      supplier_id: "s1",
      ingredient_id: "i1",
    },
  ],
  supplier_invoices: [],
});

beforeEach(() => {
  TABLES = {};
});

describe("Costos rendered on the server, all three tabs", () => {
  for (const tab of [undefined, "compras", "proveedores"]) {
    const name = tab ?? "precios";
    it(`empty company · ${name}: no throw, Compras KPI is «—»`, async () => {
      const t = await drawCosts(tab);
      expect(t).toContain("Compras · 30 días");
      expect(t).toMatch(/Compras · 30 días —/);
      expect(t).not.toMatch(/\$\s?0(?![.,\d])/);
    });
    it(`populated company · ${name}: no throw, Compras KPI is a formatted amount`, async () => {
      TABLES = POPULATED();
      const t = await drawCosts(tab);
      expect(t).toMatch(/Compras · 30 días \$1,234/);
      expect(t).not.toContain("Aún no tienes costos");
    });
  }
});

describe("the helper is not behind a client boundary", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("lives in lib/restaurant/costs-format.ts (no 'use client', no React), behaviour unchanged", async () => {
    const src = read("lib/restaurant/costs-format.ts");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/from "react"/);
    const { formatMoney, formatUnitPrice, safeCurrency } =
      await import("@/lib/restaurant/costs-format");
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney(Number.NaN, "USD")).toBe("—");
    expect(formatMoney(1234, "USD")).toBe("$1,234");
    expect(safeCurrency(undefined)).toBe("USD");
    expect(safeCurrency("peso")).toBe("USD");
    expect(safeCurrency("EUR")).toBe("EUR");
    expect(formatUnitPrice(0, "lb", "USD")).toBe("Sin precio");
    expect(formatUnitPrice(2.5, "lb", "USD")).toBe("$2.50 / lb");
  });
  it("the page and CostsArea import it from there; CostsArea no longer exports it", () => {
    expect(read("app/dashboard/restaurant/costs/page.tsx")).toContain(
      'from "@/lib/restaurant/costs-format"'
    );
    const area = read("components/restaurant/costs/CostsArea.tsx");
    expect(area).toContain('from "@/lib/restaurant/costs-format"');
    expect(area).not.toMatch(
      /export function formatMoney|export \{[^}]*formatMoney/
    );
    expect(read("app/dashboard/restaurant/costs/page.tsx")).not.toMatch(
      /formatMoney,?\s*\n?\}\s*from "@\/components\/restaurant\/costs\/CostsArea"/
    );
  });
});
