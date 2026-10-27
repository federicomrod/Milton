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
  INVOICE_LINE_PREVIEW_SELECT,
  buildInvoiceLineSummaries,
  emptyLineCounts,
  type InvoiceLinePreviewRow,
} from "@/lib/restaurant/invoice-list-preview";
import {
  purchaseWindowStart,
  summarizePurchaseWindows,
  type PurchaseWindows,
} from "@/lib/restaurant/costs-tabs";
import { isPurchaseInvoice } from "@/lib/restaurant/price-update-note";
import {
  isPurchaseCostEntry,
  loadPriceUpdateRefs,
} from "@/lib/restaurant/price-update-refs";
import type { InvoiceListItem } from "@/components/restaurant/InvoicesPage";
import type { SupplierRow } from "@/components/restaurant/SuppliersPage";

/** Invoice statuses that still need someone (not posted / rejected). */
export const PENDING_INVOICE_STATUSES = ["draft", "needs_review"] as const;

/**
 * A Telegram price update is a price, not a purchase (#313; see
 * price-update-refs.ts). Compras and «Últimas facturas» list it only while it
 * is pending (that is where a person approves it); once posted / rejected its
 * price lives on the ingredient.
 */
function isListedInvoice(inv: {
  notes?: string | null;
  status: string;
}): boolean {
  return (
    isPurchaseInvoice(inv) ||
    (PENDING_INVOICE_STATUSES as readonly string[]).includes(inv.status)
  );
}

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

    const [currency, entriesRes, supplierCountRes, pendingRes, refs] =
      await Promise.all([
        resolveCompanyCurrency(supabase, companyId),
        fetchAllRows<{
          cost_date: string;
          total_cost: number | null;
          currency: string | null;
          source_type: string | null;
          source_id: string | null;
        }>(() =>
          supabase
            .from("ingredient_cost_entries")
            .select("cost_date, total_cost, currency, source_type, source_id")
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
        loadPriceUpdateRefs(supabase, companyId),
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
      // Price updates are not purchases; refs unreadable → «—», never a total
      // that may include them (price-update-refs.ts).
      purchases:
        entriesRes.error || !refs
          ? { last30: null, previous30: null }
          : summarizePurchaseWindows(
              [...succeededRows(entriesRes)].filter((e) =>
                isPurchaseCostEntry(e, refs)
              ),
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
// «Últimas facturas» (top of Costos): the latest rows + how many are pending
// ---------------------------------------------------------------------------

export interface LatestInvoiceRow {
  id: string;
  supplier_name: string | null;
  invoice_date: string;
  total_amount: number | null;
  currency: string;
  status: string;
  source_type: string;
  notes: string | null;
  original_file_name: string | null;
}

export interface LatestInvoices {
  rows: LatestInvoiceRow[];
  /** Pending rows (PENDING_INVOICE_STATUSES) from a real count; null if the count failed. */
  pendingCount: number | null;
  /** First pending invoice in list order (what «Revisar» opens), or null. */
  firstPendingId: string | null;
}

export const LATEST_INVOICES_LIMIT = 5;

/**
 * Light, company-scoped read for the box at the top of Costos: the latest
 * invoices (same order as Compras) and the real pending count. null = not
 * signed in or the read failed (the box is then simply not drawn).
 */
export async function loadLatestInvoices(
  limit: number = LATEST_INVOICES_LIMIT
): Promise<LatestInvoices | null> {
  try {
    const scope = await companyScope();
    if (!scope) return null;
    const { supabase, companyId } = scope;
    const columns =
      "id, supplier_id, invoice_date, total_amount, currency, status, source_type, notes, original_file_name";
    const [latestRes, pendingCountRes, firstPendingRes] = await Promise.all([
      supabase
        .from("supplier_invoices")
        .select(columns)
        .eq("company_id", companyId)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        // Over-fetch: posted price updates are dropped below (#313).
        .limit(Math.min(50, limit * 3)),
      supabase
        .from("supplier_invoices")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", [...PENDING_INVOICE_STATUSES]),
      supabase
        .from("supplier_invoices")
        .select("id")
        .eq("company_id", companyId)
        .in("status", [...PENDING_INVOICE_STATUSES])
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (latestRes.error) {
      console.error("[costs/latest-invoices]", latestRes.error.message);
      return null;
    }
    type Raw = Omit<LatestInvoiceRow, "supplier_name"> & {
      supplier_id: string | null;
    };
    const raw = ((latestRes.data ?? []) as Raw[])
      .filter(isListedInvoice)
      .slice(0, limit);
    const supplierIds = [
      ...new Set(raw.map((r) => r.supplier_id).filter(Boolean)),
    ] as string[];
    const names = new Map<string, string>();
    if (supplierIds.length > 0) {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", supplierIds);
      for (const s of (data ?? []) as { id: string; name: string }[])
        names.set(s.id, s.name);
    }
    const first = (firstPendingRes.data ?? []) as { id: string }[];
    return {
      rows: raw.map((r) => ({
        id: r.id,
        supplier_name: r.supplier_id
          ? (names.get(r.supplier_id) ?? null)
          : null,
        invoice_date: r.invoice_date,
        total_amount: r.total_amount,
        currency: r.currency,
        status: r.status,
        source_type: r.source_type,
        notes: r.notes ?? null,
        original_file_name: r.original_file_name ?? null,
      })),
      pendingCount: pendingCountRes.error ? null : (pendingCountRes.count ?? 0),
      firstPendingId: firstPendingRes.error ? null : (first[0]?.id ?? null),
    };
  } catch (err) {
    console.error("[loadLatestInvoices] failed:", err);
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
  const [invRes, supplierRes, ingRes, companyCurrency] = await Promise.all([
    supabase
      .from("supplier_invoices")
      .select(
        "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_at, updated_at"
      )
      .eq("company_id", companyId)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase.from("suppliers").select("id, name").eq("company_id", companyId)
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

  // A posted / rejected Telegram price update is not listed (#313).
  const listedRows = (
    (invRes.data ?? []) as Array<{
      id: string;
      status: string;
      notes?: string | null;
    }>
  ).filter(isListedInvoice);

  // Lines only for the (<= 200) loaded invoices, like GET /api/restaurant/invoices.
  const invoiceIds = listedRows.map((r) => r.id);
  const lineRes =
    invoiceIds.length === 0
      ? {
          rows: [] as InvoiceLinePreviewRow[],
          truncated: false,
          error: null,
          pages: 0,
          elapsedMs: 0,
        }
      : await fetchAllRows<InvoiceLinePreviewRow>(() =>
          supabase
            .from("supplier_invoice_lines")
            .select(INVOICE_LINE_PREVIEW_SELECT)
            .eq("company_id", companyId)
            .in("invoice_id", invoiceIds)
        );

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

  const ingredientRows = [...succeededRows(ingRes)];
  const summaries = buildInvoiceLineSummaries(
    invoiceIds,
    succeededRows(lineRes),
    new Map(ingredientRows.map((i) => [i.id, i.name]))
  );

  const invoices: InvoiceListItem[] = (
    listedRows as Array<{
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
    line_counts: summaries.get(r.id)?.counts ?? emptyLineCounts(),
    line_preview: summaries.get(r.id)?.preview ?? [],
  }));

  return {
    invoices,
    suppliers,
    ingredients: ingredientRows.sort((a, b) => a.name.localeCompare(b.name)),
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
  const currency = await resolveCompanyCurrency(supabase, companyId);

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
  const [linksRes, costRes, refs] = await Promise.all([
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
      source_type: string | null;
      source_id: string | null;
    }>(() =>
      supabase
        .from("ingredient_cost_entries")
        .select("supplier_id, cost_date, total_cost, source_type, source_id")
        .eq("company_id", companyId)
        .not("supplier_id", "is", null)
    ),
    loadPriceUpdateRefs(supabase, companyId),
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
  // Price updates are not purchases (price-update-refs.ts); refs unreadable →
  // spend and «última compra» stay «—», never a number that may include them.
  for (const e of refs ? succeededRows(costRes) : []) {
    if (!isPurchaseCostEntry(e, refs as NonNullable<typeof refs>)) continue;
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
      currency,
    };
  });
}
