// lib/restaurant/costs-page-data.ts
//
// Server loaders for Costos (R1-09b, A9/D6): the KPI extras (30-day
// purchases, suppliers, pending invoices) and the Compras / Proveedores
// tab data that used to live in /invoices and /suppliers pages.
// Company always comes from auth, never from the request.

import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import {
  fetchAllRows,
  succeededRows,
  warnIfTruncated,
} from "@/lib/restaurant/paginated-read";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  purchaseWindowStart,
  summarizePurchaseWindows,
  type PurchaseWindows,
} from "@/lib/restaurant/costs-tabs";
import type { InvoiceListItem } from "@/components/restaurant/InvoicesPage";
import type { SupplierRow } from "@/components/restaurant/SuppliersPage";

/** Invoice statuses that still need someone (not posted / rejected). */
export const PENDING_INVOICE_STATUSES = ["draft", "needs_review"] as const;

async function companyScope() {
  const user = await getCachedAuthUser();
  if (!user?.id) return null;
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) return null;
  const supabase = await createClient();
  return { supabase, companyId };
}

export interface CostsKpiExtras {
  purchases: PurchaseWindows;
  currency: string;
  supplierCount: number | null;
  suppliersWithPendingInvoices: number | null;
}

export async function loadCostsKpiExtras(
  today: Date = new Date()
): Promise<CostsKpiExtras | null> {
  try {
    const scope = await companyScope();
    if (!scope) return null;
    const { supabase, companyId } = scope;

    const [currency, entriesRes, supplierCountRes, pendingRes] =
      await Promise.all([
        resolveCompanyCurrency(supabase, companyId),
        fetchAllRows<{
          cost_date: string;
          total_cost: number | null;
          currency: string | null;
        }>(() =>
          supabase
            .from("ingredient_cost_entries")
            .select("cost_date, total_cost, currency")
            .eq("company_id", companyId)
            .not("supplier_id", "is", null)
            .gte("cost_date", purchaseWindowStart(today))
        ),
        supabase
          .from("suppliers")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        supabase
          .from("supplier_invoices")
          .select("supplier_id")
          .eq("company_id", companyId)
          .in("status", [...PENDING_INVOICE_STATUSES])
          .limit(1000),
      ]);

    if (entriesRes.error) {
      console.error("[costs page] cost entries:", entriesRes.error.message);
    }
    warnIfTruncated("costs page cost entries", entriesRes);

    const pendingSuppliers = pendingRes.error
      ? null
      : new Set(
          ((pendingRes.data ?? []) as { supplier_id: string | null }[])
            .map((r) => r.supplier_id)
            .filter(Boolean)
        ).size;

    return {
      purchases: entriesRes.error
        ? { last30: null, previous30: null }
        : summarizePurchaseWindows(
            [...succeededRows(entriesRes)],
            today,
            currency
          ),
      currency,
      supplierCount: supplierCountRes.error
        ? null
        : (supplierCountRes.count ?? 0),
      suppliersWithPendingInvoices: pendingSuppliers,
    };
  } catch (err) {
    console.error("[loadCostsKpiExtras] failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compras tab (was /dashboard/restaurant/invoices)
// ---------------------------------------------------------------------------

export interface InvoicesTabData {
  invoices: InvoiceListItem[];
  suppliers: { id: string; name: string }[];
  ingredients: { id: string; name: string; default_unit: string | null }[];
  companyCurrency: string;
}

export async function loadInvoicesTabData(): Promise<InvoicesTabData | null> {
  // A brand-new company has nothing here, and a failed read must never take
  // Costos down: an empty (not null: null means "sign in") result.
  try {
    return await loadInvoicesTabDataUnsafe();
  } catch (err) {
    console.error("[loadInvoicesTabData] failed:", err);
    return {
      invoices: [],
      suppliers: [],
      ingredients: [],
      companyCurrency: "USD",
    };
  }
}

async function loadInvoicesTabDataUnsafe(): Promise<InvoicesTabData | null> {
  const scope = await companyScope();
  if (!scope) return null;
  const { supabase, companyId } = scope;

  // Invoice list + line counts (for "matched/total" pills without another
  // round-trip). Suppliers feed the manual create form's select.
  const [invRes, lineRes, supplierRes, ingRes, companyCurrency] =
    await Promise.all([
      supabase
        .from("supplier_invoices")
        .select(
          "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_at, updated_at"
        )
        .eq("company_id", companyId)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
      fetchAllRows<{
        invoice_id: string;
        match_status: string;
        review_status: string;
      }>(() =>
        supabase
          .from("supplier_invoice_lines")
          .select("invoice_id, match_status, review_status")
          .eq("company_id", companyId)
      ),
      fetchAllRows<{ id: string; name: string }>(() =>
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("company_id", companyId)
      ),
      fetchAllRows<{
        id: string;
        name: string;
        default_unit: string | null;
      }>(() =>
        supabase
          .from("ingredients")
          .select("id, name, default_unit")
          .eq("company_id", companyId)
      ),
      resolveCompanyCurrency(supabase, companyId),
    ]);

  if (invRes.error)
    console.error("[costs/compras] supplier_invoices:", invRes.error.message);
  if (lineRes.error)
    console.error(
      "[costs/compras] supplier_invoice_lines:",
      lineRes.error.message
    );
  if (supplierRes.error)
    console.error("[costs/compras] suppliers:", supplierRes.error.message);
  if (ingRes.error)
    console.error("[costs/compras] ingredients:", ingRes.error.message);
  warnIfTruncated("costs/compras lines", lineRes);

  const suppliers = [...succeededRows(supplierRes)].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

  type LineCount = InvoiceListItem["line_counts"];
  const emptyCount = (): LineCount => ({
    total: 0,
    matched: 0,
    approved: 0,
    unmatched: 0,
    pending: 0,
  });
  const lineCounts = new Map<string, LineCount>();
  for (const row of (invRes.data ?? []) as { id: string }[]) {
    lineCounts.set(row.id, emptyCount());
  }
  for (const l of succeededRows(lineRes)) {
    const bucket = lineCounts.get(l.invoice_id);
    if (!bucket) continue;
    bucket.total++;
    if (l.match_status === "matched" || l.match_status === "auto_matched") {
      bucket.matched++;
    }
    if (l.match_status === "unmatched") bucket.unmatched++;
    if (l.review_status === "approved") bucket.approved++;
    if (l.review_status === "pending") bucket.pending++;
  }

  const invoices: InvoiceListItem[] = (
    (invRes.data ?? []) as Array<{
      id: string;
      supplier_id: string | null;
      invoice_number: string | null;
      invoice_date: string;
      due_date: string | null;
      currency: string;
      total_amount: number | null;
      status: string;
      source_type: string;
      notes?: string | null;
      original_file_name?: string | null;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_id
      ? (supplierNameById.get(r.supplier_id) ?? null)
      : null,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    currency: r.currency,
    total_amount: r.total_amount,
    status: r.status,
    source_type: r.source_type,
    notes: r.notes ?? null,
    original_file_name: r.original_file_name ?? null,
    created_at: r.created_at,
    line_counts: lineCounts.get(r.id) ?? emptyCount(),
  }));

  return {
    invoices,
    suppliers,
    ingredients: [...succeededRows(ingRes)].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    companyCurrency,
  };
}

// ---------------------------------------------------------------------------
// Proveedores tab (was /dashboard/restaurant/suppliers)
// ---------------------------------------------------------------------------

export async function loadSuppliersTabData(): Promise<SupplierRow[] | null> {
  try {
    return await loadSuppliersTabDataUnsafe();
  } catch (err) {
    console.error("[loadSuppliersTabData] failed:", err);
    return [];
  }
}

async function loadSuppliersTabDataUnsafe(): Promise<SupplierRow[] | null> {
  const scope = await companyScope();
  if (!scope) return null;
  const { supabase, companyId } = scope;

  // Full column set first; if migration 007 is missing the extended
  // columns error the whole select, so fall back to the always-present
  // ones (missing fields render as "—").
  const FULL_COLS =
    "id, name, status, contact_name, email, phone, notes, address, payment_terms, tax_id, created_at, updated_at";
  const MINIMAL_COLS = "id, name, status";

  const byName = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""));

  const fullRes = await fetchAllRows<Record<string, unknown>>(() =>
    supabase.from("suppliers").select(FULL_COLS).eq("company_id", companyId)
  );
  let supplierRows: Record<string, unknown>[] = [
    ...succeededRows(fullRes),
  ].sort(byName);

  if (fullRes.error) {
    console.error(
      "[costs/proveedores] full select failed, falling back:",
      fullRes.error.message
    );
    const minimalRes = await fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("suppliers")
        .select(MINIMAL_COLS)
        .eq("company_id", companyId)
    );
    if (minimalRes.error) {
      console.error(
        "[costs/proveedores] minimal select also failed:",
        minimalRes.error.message
      );
    }
    supplierRows = [...succeededRows(minimalRes)].sort(byName);
  }

  // Metrics are best-effort: a failed read degrades the metric to "—".
  const [linksRes, costRes] = await Promise.all([
    fetchAllRows<{ supplier_id: string; ingredient_id: string }>(() =>
      supabase
        .from("supplier_ingredients")
        .select("supplier_id, ingredient_id")
        .eq("company_id", companyId)
    ),
    fetchAllRows<{
      supplier_id: string;
      cost_date: string;
      total_cost: number;
    }>(() =>
      supabase
        .from("ingredient_cost_entries")
        .select("supplier_id, cost_date, total_cost")
        .eq("company_id", companyId)
        .not("supplier_id", "is", null)
    ),
  ]);

  if (linksRes.error) {
    console.error(
      "[costs/proveedores] supplier_ingredients:",
      linksRes.error.message
    );
  }
  if (costRes.error) {
    console.error(
      "[costs/proveedores] ingredient_cost_entries:",
      costRes.error.message
    );
  }
  warnIfTruncated("costs/proveedores links", linksRes);
  warnIfTruncated("costs/proveedores cost entries", costRes);

  const ingredientCount = new Map<string, number>();
  for (const l of succeededRows(linksRes)) {
    ingredientCount.set(
      l.supplier_id,
      (ingredientCount.get(l.supplier_id) ?? 0) + 1
    );
  }
  const latestCostDate = new Map<string, string>();
  const totalSpend = new Map<string, number>();
  for (const e of succeededRows(costRes)) {
    const prev = latestCostDate.get(e.supplier_id);
    if (!prev || e.cost_date > prev)
      latestCostDate.set(e.supplier_id, e.cost_date);
    totalSpend.set(
      e.supplier_id,
      (totalSpend.get(e.supplier_id) ?? 0) + (e.total_cost ?? 0)
    );
  }

  return supplierRows.map((s) => {
    const id = s.id as string;
    return {
      id,
      name: s.name as string,
      status: (s.status as string) ?? "active",
      contact_name: (s.contact_name as string | null) ?? null,
      email: (s.email as string | null) ?? null,
      phone: (s.phone as string | null) ?? null,
      notes: (s.notes as string | null) ?? null,
      address: (s.address as string | null) ?? null,
      payment_terms: (s.payment_terms as string | null) ?? null,
      tax_id: (s.tax_id as string | null) ?? null,
      ingredient_count: ingredientCount.get(id) ?? 0,
      latest_cost_date: latestCostDate.get(id) ?? null,
      total_spend: totalSpend.get(id) ?? null,
    };
  });
}
