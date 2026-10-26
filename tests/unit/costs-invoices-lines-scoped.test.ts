// loadInvoicesTabData reads supplier_invoice_lines only for the loaded
// invoice ids (same as GET /api/restaurant/invoices), company-scoped, and never
// runs a lines query with an empty in-list. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CO = "11111111-1111-4111-8111-111111111111";
type Call = {
  table: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
};
let calls: Call[] = [];
let invoiceRows: { id: string }[] = [];

function builder(table: string) {
  const call: Call = { table, eq: [], in: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain;
  b.limit = chain;
  b.not = chain;
  b.gte = chain;
  b.is = chain;
  b.eq = (c: string, v: unknown) => (call.eq.push([c, v]), b);
  b.in = (c: string, v: unknown[]) => (call.in.push([c, v]), b);
  b.order = (c: string) => {
    if (table === "supplier_invoices" && c !== "id") return b;
    return { range: async () => ({ data: [], error: null }) };
  };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({
      data: table === "supplier_invoices" ? invoiceRows : [],
      error: null,
    }).then(res);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1" }),
  getCachedCompanyId: async () => CO,
}));

const lineCalls = () =>
  calls.filter((c) => c.table === "supplier_invoice_lines");

describe("loadInvoicesTabData lines read", () => {
  beforeEach(() => {
    calls = [];
    invoiceRows = [];
  });

  it("scopes the lines query by company and the loaded invoice ids", async () => {
    invoiceRows = [{ id: "inv-a" }, { id: "inv-b" }];
    const { loadInvoicesTabData } =
      await import("@/lib/restaurant/costs-page-data");
    await loadInvoicesTabData();
    const lc = lineCalls();
    expect(lc.length).toBeGreaterThan(0);
    for (const c of lc) {
      expect(c.eq).toContainEqual(["company_id", CO]);
      expect(c.in).toEqual([["invoice_id", ["inv-a", "inv-b"]]]);
    }
  });

  it("runs no lines query when there are no invoices", async () => {
    invoiceRows = [];
    const { loadInvoicesTabData } =
      await import("@/lib/restaurant/costs-page-data");
    const out = await loadInvoicesTabData();
    expect(out?.invoices).toEqual([]);
    expect(lineCalls()).toHaveLength(0);
  });
});
