// #313: a Telegram price update is a PRICE, never a PURCHASE.
// Data side: the shared helpers, purchase KPI, Proveedores, suppliers API,
// profitability, setup count, Ask Milton, lists, labels, company isolation and
// the refs-read-failure rule. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";
import {
  INVOICE_TELEGRAM_NOTE,
  LEGACY_PRICE_UPDATE_NOTE_PREFIX,
  PRICE_UPDATE_NOTE_PREFIX,
  isPurchaseInvoice,
} from "@/lib/restaurant/price-update-note";
import {
  isPurchaseCostEntry,
  loadPriceUpdateRefs,
} from "@/lib/restaurant/price-update-refs";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";
const TODAY = new Date("2026-10-27T12:00:00Z");

let store: FakeStore = {};
let failRefs = false;
let calls: Array<{
  table: string;
  eq: unknown[][];
  in: unknown[][];
  like: unknown[][];
}> = [];

function recordingDb() {
  const base = makeFakeDb(store);
  return {
    from(table: string) {
      const b = base.from(table) as Record<string, unknown>;
      const rec = { table, eq: [], in: [], like: [] } as (typeof calls)[number];
      calls.push(rec);
      const proxy: unknown = new Proxy(b, {
        get(target, prop) {
          const v = target[prop as string];
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "eq") rec.eq.push(args);
            if (prop === "in") rec.in.push(args);
            if (prop === "like") {
              rec.like.push(args);
              // Simulates a failed refs read.
              if (failRefs) {
                return {
                  order: () => ({
                    range: async () => ({
                      data: null,
                      error: { message: "boom" },
                    }),
                  }),
                };
              }
            }
            const r = (v as (...a: unknown[]) => unknown)(...args);
            return r === b ? proxy : r;
          };
        },
      });
      return proxy;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => recordingDb(),
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1" }),
  getCachedCompanyId: async () => CO_A,
}));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    userId: "u1",
    companyId: CO_A,
    supabase: recordingDb(),
  }),
}));

const puNote = `${PRICE_UPDATE_NOTE_PREFIX}\n- Aguacate Test: 1.50`;
const baseInv = {
  invoice_number: null,
  due_date: null,
  currency: "USD",
  subtotal: null,
  tax_amount: null,
  source_type: "manual",
  original_file_name: null,
};

function seed() {
  store = {
    suppliers: [
      {
        id: "sup-1",
        company_id: CO_A,
        name: "Proveedor Test",
        status: "active",
      },
    ],
    supplier_invoices: [
      {
        ...baseInv,
        id: "inv-real",
        company_id: CO_A,
        supplier_id: "sup-1",
        invoice_date: "2026-10-20",
        total_amount: 120,
        status: "posted",
        notes: null,
        created_at: "2026-10-20T10:00:00Z",
      },
      {
        // Approved price update WITH a supplier attached: the rule must not
        // rely on supplier_id being NULL.
        ...baseInv,
        id: "inv-pu-posted",
        company_id: CO_A,
        supplier_id: "sup-1",
        invoice_date: "2026-10-26",
        total_amount: 5.75,
        status: "posted",
        notes: puNote,
        created_at: "2026-10-26T10:00:00Z",
      },
      {
        ...baseInv,
        id: "inv-pu-legacy",
        company_id: CO_A,
        supplier_id: null,
        invoice_date: "2026-10-25",
        total_amount: 3,
        status: "posted",
        notes: LEGACY_PRICE_UPDATE_NOTE_PREFIX,
        created_at: "2026-10-25T10:00:00Z",
      },
      {
        ...baseInv,
        id: "inv-pu-review",
        company_id: CO_A,
        supplier_id: null,
        invoice_date: "2026-10-27",
        total_amount: 4.25,
        status: "needs_review",
        notes: puNote,
        created_at: "2026-10-27T10:00:00Z",
      },
      {
        ...baseInv,
        id: "inv-B-pu",
        company_id: CO_B,
        supplier_id: "sup-B",
        invoice_date: "2026-10-26",
        total_amount: 9,
        status: "posted",
        notes: puNote,
        created_at: "2026-10-26T10:00:00Z",
      },
    ],
    supplier_invoice_lines: [
      { id: "line-real", company_id: CO_A, invoice_id: "inv-real" },
      { id: "line-pu", company_id: CO_A, invoice_id: "inv-pu-posted" },
      { id: "line-pu-legacy", company_id: CO_A, invoice_id: "inv-pu-legacy" },
      { id: "line-pu-review", company_id: CO_A, invoice_id: "inv-pu-review" },
      { id: "line-B", company_id: CO_B, invoice_id: "inv-B-pu" },
    ],
    ingredient_cost_entries: [
      {
        id: "ce-real",
        company_id: CO_A,
        ingredient_id: "ing-1",
        supplier_id: "sup-1",
        source_type: "invoice_line",
        source_id: "line-real",
        cost_date: "2026-10-20",
        total_cost: 120,
        currency: "USD",
      },
      {
        id: "ce-pu",
        company_id: CO_A,
        ingredient_id: "ing-1",
        supplier_id: "sup-1",
        source_type: "invoice_line",
        source_id: "line-pu",
        cost_date: "2026-10-26",
        total_cost: 1.5,
        currency: "USD",
      },
      {
        id: "ce-B",
        company_id: CO_B,
        ingredient_id: "ing-B",
        supplier_id: "sup-B",
        source_type: "invoice_line",
        source_id: "line-B",
        cost_date: "2026-10-26",
        total_cost: 9,
        currency: "USD",
      },
    ],
    ingredients: [
      { id: "ing-1", company_id: CO_A, name: "Aguacate Test" },
      { id: "ing-2", company_id: CO_A, name: "Queso Test" },
    ],
  };
}

beforeEach(() => {
  seed();
  failRefs = false;
  calls = [];
});

describe("helpers (1)", () => {
  it("isPurchaseInvoice", () => {
    expect(isPurchaseInvoice({ notes: PRICE_UPDATE_NOTE_PREFIX + "x" })).toBe(
      false
    );
    expect(isPurchaseInvoice({ notes: LEGACY_PRICE_UPDATE_NOTE_PREFIX })).toBe(
      false
    );
    expect(isPurchaseInvoice({ notes: null })).toBe(true);
    expect(isPurchaseInvoice({})).toBe(true);
    expect(isPurchaseInvoice({ notes: INVOICE_TELEGRAM_NOTE })).toBe(true);
  });

  it("isPurchaseCostEntry", () => {
    const refs = {
      invoiceIds: new Set(["i"]),
      lineIds: new Set(["line-pu"]),
    };
    const e = (source_type: string | null, source_id: string | null) =>
      isPurchaseCostEntry({ source_type, source_id }, refs);
    expect(e("manual", null)).toBe(true);
    expect(e("import", null)).toBe(true);
    expect(e("invoice_line", "line-real")).toBe(true);
    expect(e("invoice_line", "line-pu")).toBe(false);
    // Same id under another source type is not a price-update line.
    expect(e("manual", "line-pu")).toBe(true);
  });

  it("loadPriceUpdateRefs finds current + legacy prefixes of this company only", async () => {
    const refs = await loadPriceUpdateRefs(recordingDb(), CO_A);
    expect([...refs!.invoiceIds].sort()).toEqual([
      "inv-pu-legacy",
      "inv-pu-posted",
      "inv-pu-review",
    ]);
    expect([...refs!.lineIds].sort()).toEqual([
      "line-pu",
      "line-pu-legacy",
      "line-pu-review",
    ]);
  });

  it("loadPriceUpdateRefs: no price updates → no lines query (never an empty in-list)", async () => {
    store.supplier_invoices = store.supplier_invoices.filter(
      (r) => r.notes === null
    );
    const refs = await loadPriceUpdateRefs(recordingDb(), CO_A);
    expect(refs!.invoiceIds.size).toBe(0);
    expect(calls.some((c) => c.table === "supplier_invoice_lines")).toBe(false);
  });
});

describe("purchase totals (2, 4, 6)", () => {
  it("«Compras · 30 días» ignores the approved price update (supplier attached)", async () => {
    const { loadCostsKpiExtras } =
      await import("@/lib/restaurant/costs-page-data");
    const out = await loadCostsKpiExtras(TODAY);
    expect(out?.purchases.last30).toBe(120);
    expect(out?.purchases.previous30).toBeNull();
  });

  it("Proveedores: total_spend and latest_cost_date are real purchases only", async () => {
    const { loadSuppliersTabData } =
      await import("@/lib/restaurant/costs-page-data");
    const rows = await loadSuppliersTabData();
    expect(rows?.[0].total_spend).toBe(120);
    expect(rows?.[0].latest_cost_date).toBe("2026-10-20");
  });

  it("suppliers API: same numbers", async () => {
    const { GET } = await import("@/app/api/restaurant/suppliers/route");
    const body = await (await GET()).json();
    expect(body.suppliers[0].total_spend).toBe(120);
    expect(body.suppliers[0].latest_cost_date).toBe("2026-10-20");
  });

  it("a supplier whose only entries are price updates shows no spend (null, not 0)", async () => {
    store.ingredient_cost_entries = store.ingredient_cost_entries.filter(
      (e) => e.id !== "ce-real"
    );
    const { GET } = await import("@/app/api/restaurant/suppliers/route");
    const body = await (await GET()).json();
    expect(body.suppliers[0].total_spend).toBeNull();
    expect(body.suppliers[0].latest_cost_date).toBeNull();
  });

  it("every new query is company-scoped (6)", async () => {
    const { loadCostsKpiExtras, loadSuppliersTabData } =
      await import("@/lib/restaurant/costs-page-data");
    await loadCostsKpiExtras(TODAY);
    await loadSuppliersTabData();
    for (const c of calls.filter((x) =>
      [
        "ingredient_cost_entries",
        "supplier_invoices",
        "supplier_invoice_lines",
      ].includes(x.table)
    )) {
      expect(c.eq).toContainEqual(["company_id", CO_A]);
    }
    for (const c of calls.filter((x) => x.table === "supplier_invoice_lines")) {
      for (const [, ids] of c.in)
        expect((ids as string[]).length).toBeGreaterThan(0);
    }
  });
});

describe("refs read failure (7)", () => {
  it("purchase KPI, Proveedores and suppliers API show null, never 0 or a total with the price update", async () => {
    failRefs = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadCostsKpiExtras, loadSuppliersTabData } =
      await import("@/lib/restaurant/costs-page-data");
    const kpi = await loadCostsKpiExtras(TODAY);
    expect(kpi?.purchases).toEqual({ last30: null, previous30: null });
    const rows = await loadSuppliersTabData();
    expect(rows?.[0].total_spend).toBeNull();
    expect(rows?.[0].latest_cost_date).toBeNull();
    const { GET } = await import("@/app/api/restaurant/suppliers/route");
    const body = await (await GET()).json();
    expect(body.suppliers[0].total_spend).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("profitability + setup count (2, 3, 4, 7)", () => {
  async function run() {
    const { fetchProfitabilityData } =
      await import("@/lib/restaurant/profitability-server");
    return fetchProfitabilityData(recordingDb() as never, CO_A);
  }

  it("supplier spend is 120 exactly; the price update stays in the costing entries", async () => {
    const data = await run();
    expect(data.total_supplier_spend).toBe(120);
    expect(data.topSupplierSpend).toHaveLength(1);
    expect(data.topSupplierSpend[0].total_spend).toBe(120);
    expect(data.topSupplierSpend[0].pct_of_total).toBe(100);
    // The price update's cost entry still counts as a price (ingredient with
    // entries / latest price), it is only excluded from spend.
    expect(data.dataQuality.ingredients_without_cost_entries).toBe(1);
  });

  it("refs failure → total_supplier_spend null and no supplier rows", async () => {
    failRefs = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await run();
    expect(data.total_supplier_spend).toBeNull();
    expect(data.topSupplierSpend).toEqual([]);
    errSpy.mockRestore();
  });

  it("purchaseInvoicesCount: price-update invoices are not invoices", async () => {
    const { purchaseInvoicesCount } =
      await import("@/lib/restaurant/profitability-server");
    const refs = { invoiceIds: new Set(["a", "b", "c"]) };
    expect(purchaseInvoicesCount(3, refs)).toBe(0);
    expect(purchaseInvoicesCount(4, refs)).toBe(1);
    expect(purchaseInvoicesCount(1, refs)).toBe(0);
    expect(purchaseInvoicesCount(0, null)).toBe(0);
    expect(purchaseInvoicesCount(5, null)).toBe(0);
  });
});

describe("Ask Milton invoices (2)", () => {
  it("price updates are not in latest / needs_review / posted_count", async () => {
    const { buildAskMiltonContext } =
      await import("@/lib/restaurant/ask-milton-context");
    const ctx = await buildAskMiltonContext(recordingDb() as never, CO_A);
    expect(ctx.invoices.latest.map((i) => i.invoice_id)).toEqual(["inv-real"]);
    expect(ctx.invoices.needs_review).toEqual([]);
    expect(ctx.invoices.posted_count).toBe(1);
    expect(ctx.invoices.needs_review_count).toBe(0);
  });
});

describe("lists (5)", () => {
  it("Compras tab: posted price updates are not listed, a needs_review one is", async () => {
    const { loadInvoicesTabData } =
      await import("@/lib/restaurant/costs-page-data");
    const out = await loadInvoicesTabData();
    const ids = out!.invoices.map((i) => i.id).sort();
    expect(ids).toEqual(["inv-pu-review", "inv-real"]);
    // The pending price update keeps its notes so the UI can show the label.
    expect(
      out!.invoices.find((i) => i.id === "inv-pu-review")?.notes
    ).toContain(PRICE_UPDATE_NOTE_PREFIX);
  });

  it("GET /api/restaurant/invoices matches the server render", async () => {
    const { GET } = await import("@/app/api/restaurant/invoices/route");
    const res = await GET(
      new NextRequest("http://localhost/api/restaurant/invoices")
    );
    const body = await res.json();
    expect(body.invoices.map((i: { id: string }) => i.id).sort()).toEqual([
      "inv-pu-review",
      "inv-real",
    ]);
  });

  it("«Últimas facturas»: posted price updates dropped, pending kept, still up to 5 rows", async () => {
    const { loadLatestInvoices } =
      await import("@/lib/restaurant/costs-page-data");
    const out = await loadLatestInvoices();
    expect(out!.rows.map((r) => r.id)).toEqual(["inv-pu-review", "inv-real"]);
    // Many posted price updates must not crowd real invoices out of the box.
    for (let i = 0; i < 6; i++) {
      (store.supplier_invoices as Record<string, unknown>[]).push({
        ...baseInv,
        id: `inv-real-${i}`,
        company_id: CO_A,
        supplier_id: null,
        invoice_date: `2026-09-0${i + 1}`,
        total_amount: 10,
        status: "posted",
        notes: null,
        created_at: "2026-09-01T00:00:00Z",
      });
    }
    const again = await loadLatestInvoices();
    expect(again!.rows).toHaveLength(5);
    expect(again!.rows.some((r) => r.id === "inv-pu-posted")).toBe(false);
  });
});

describe("price keeps its effect (3)", () => {
  it("Ingredientes label is «Telegram»; without refs it falls back to «factura»", async () => {
    const { priceSourceOf, PRICE_SOURCE_LABEL } =
      await import("@/lib/restaurant/ingredientes-screen");
    const entry = { source_type: "invoice_line", source_id: "line-pu" };
    expect(priceSourceOf(entry, new Set(["line-pu"]))).toBe("telegram");
    expect(PRICE_SOURCE_LABEL.telegram).toBe("Telegram");
    expect(priceSourceOf(entry, new Set())).toBe("factura");
    expect(priceSourceOf(entry, null)).toBe("factura");
    expect(priceSourceOf(entry)).toBe("factura");
    expect(
      priceSourceOf(
        { source_type: "invoice_line", source_id: "line-real" },
        new Set(["line-pu"])
      )
    ).toBe("factura");
  });

  it("fetchIngredientLatestCosts still sees the price update as the latest price, labelled Telegram", async () => {
    const { fetchIngredientLatestCosts } =
      await import("@/lib/restaurant/menu-recipes-server");
    const rows = await fetchIngredientLatestCosts(recordingDb() as never, CO_A);
    const avocado = rows.find((r) => r.name === "Aguacate Test");
    expect(avocado?.latest?.id).toBe("ce-pu");
    expect(avocado?.latest?.source).toBe("telegram");
  });
});
