// app/api/restaurant/invoices/route.ts
//
// GET  /api/restaurant/invoices
//   Lists supplier_invoices for the current company (newest first) joined
//   with a small match-progress summary computed from supplier_invoice_lines.
//
// POST /api/restaurant/invoices
//   Creates a manual invoice header. Lines are added via
//   /api/restaurant/invoices/:id/lines.
//
//   Body: {
//     supplier_id?     : string,
//     supplier_name?   : string,  // autocreated if no id
//     invoice_number?  : string,
//     invoice_date     : string ("YYYY-MM-DD"),
//     due_date?        : string,
//     currency?        : string,
//     subtotal?        : number,
//     tax_amount?      : number,
//     total_amount?    : number,
//     notes?           : string
//   }

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { fetchAllRows, warnIfTruncated } from "@/lib/restaurant/paginated-read";
import {
  INVOICE_LINE_PREVIEW_SELECT,
  buildInvoiceLineSummaries,
  emptyLineCounts,
  type InvoiceLinePreviewRow,
} from "@/lib/restaurant/invoice-list-preview";
import { isPurchaseInvoice } from "@/lib/restaurant/price-update-note";
import {
  isInvoiceStatus,
  type SupplierInvoice,
} from "@/types/supplier-invoices";
import {
  currencyMismatchReason,
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INVOICE_SELECT =
  "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at";

// ---------------------------------------------------------------------------
// GET — list invoices
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");

  let query = supabase
    .from("supplier_invoices")
    .select(INVOICE_SELECT)
    .eq("company_id", companyId)
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter && isInvoiceStatus(statusFilter)) {
    query = query.eq("status", statusFilter);
  }
  const { data: allInvoices, error } = await query;
  if (error) {
    console.error("[invoices GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }

  // A posted / rejected Telegram price update is not a purchase and is not
  // listed (same rule as the Compras tab; price-update-refs.ts). A pending one
  // stays: that is where a person approves it.
  const invoices = (allInvoices ?? []).filter((i) => {
    const inv = i as SupplierInvoice;
    return (
      isPurchaseInvoice(inv) ||
      inv.status === "draft" ||
      inv.status === "needs_review"
    );
  });

  // Pull aggregated line counts in one round-trip so the list can show
  // "matched / total" progress without a per-row query.
  const ids = (invoices ?? []).map((i) => (i as SupplierInvoice).id);
  let summaries = buildInvoiceLineSummaries(ids, [], new Map());
  if (ids.length > 0) {
    const linesRes = await fetchAllRows<InvoiceLinePreviewRow>(() =>
      supabase
        .from("supplier_invoice_lines")
        .select(INVOICE_LINE_PREVIEW_SELECT)
        .eq("company_id", companyId)
        .in("invoice_id", ids)
    );
    if (linesRes.error) {
      console.error("[invoices GET] line counts:", linesRes.error.message);
    } else {
      warnIfTruncated("invoices GET line counts", linesRes);
      // Names of the matched ingredients (company-scoped, one lookup).
      const ingredientIds = Array.from(
        new Set(
          linesRes.rows
            .map((l) => l.ingredient_id)
            .filter((x): x is string => !!x)
        )
      );
      const ingredientNameById = new Map<string, string>();
      if (ingredientIds.length > 0) {
        const { data: ings } = await supabase
          .from("ingredients")
          .select("id, name")
          .eq("company_id", companyId)
          .in("id", ingredientIds);
        for (const i of (ings ?? []) as { id: string; name: string }[]) {
          ingredientNameById.set(i.id, i.name);
        }
      }
      summaries = buildInvoiceLineSummaries(
        ids,
        linesRes.rows,
        ingredientNameById
      );
    }
  }

  // Suppliers lookup for display names.
  const supplierIds = Array.from(
    new Set(
      (invoices ?? [])
        .map((i) => (i as SupplierInvoice).supplier_id)
        .filter((s): s is string => !!s)
    )
  );
  const supplierNameById = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", supplierIds);
    for (const s of (suppliers ?? []) as { id: string; name: string }[]) {
      supplierNameById.set(s.id, s.name);
    }
  }

  const enriched = (invoices ?? []).map((row) => {
    const inv = row as SupplierInvoice;
    return {
      ...inv,
      supplier_name: inv.supplier_id
        ? (supplierNameById.get(inv.supplier_id) ?? null)
        : null,
      line_counts: summaries.get(inv.id)?.counts ?? emptyLineCounts(),
      line_preview: summaries.get(inv.id)?.preview ?? [],
    };
  });

  return NextResponse.json({ invoices: enriched });
}

// ---------------------------------------------------------------------------
// POST — create manual invoice header
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit");
  if (denied) return denied;
  const { supabase, companyId, userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const invoiceDate =
    typeof body.invoice_date === "string" && body.invoice_date.trim() !== ""
      ? body.invoice_date
      : null;
  if (!invoiceDate) {
    return NextResponse.json(
      { error: "invoice_date is required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // ---- Resolve / autocreate supplier ----
  let supplierId =
    typeof body.supplier_id === "string" && body.supplier_id !== ""
      ? body.supplier_id
      : null;
  const supplierName =
    typeof body.supplier_name === "string" && body.supplier_name.trim() !== ""
      ? body.supplier_name.trim()
      : null;
  if (!supplierId && supplierName) {
    // Match an existing supplier by name first, autocreate otherwise.
    const { data: existing } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .ilike("name", supplierName)
      .limit(1);
    if (existing && existing.length > 0) {
      supplierId = (existing[0] as { id: string }).id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("suppliers")
        .insert({ company_id: companyId, name: supplierName, status: "active" })
        .select("id")
        .single();
      if (createErr || !created) {
        return NextResponse.json(
          {
            error: "Could not create supplier",
            details: createErr?.message,
          },
          { status: 500 }
        );
      }
      supplierId = (created as { id: string }).id;
    }
  }

  const companyCurrency = await resolveCompanyCurrency(supabase, companyId);
  const currency = resolveWriteCurrency(body.currency, companyCurrency);
  const mismatch = currencyMismatchReason(currency, companyCurrency);
  if (mismatch) {
    return NextResponse.json({ error: mismatch }, { status: 400 });
  }

  const numberOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const insertRow = {
    company_id: companyId,
    supplier_id: supplierId,
    invoice_number:
      typeof body.invoice_number === "string" ? body.invoice_number : null,
    invoice_date: invoiceDate,
    due_date: typeof body.due_date === "string" ? body.due_date : null,
    currency,
    subtotal: numberOrNull(body.subtotal),
    tax_amount: numberOrNull(body.tax_amount),
    total_amount: numberOrNull(body.total_amount),
    status: "draft" as const,
    source_type: "manual" as const,
    notes: typeof body.notes === "string" ? body.notes : null,
    created_by_user_id: userId,
  };

  const { data: invoice, error: invErr } = await supabase
    .from("supplier_invoices")
    .insert(insertRow)
    .select(INVOICE_SELECT)
    .single();
  if (invErr || !invoice) {
    return NextResponse.json(
      { error: "Could not create invoice", details: invErr?.message },
      { status: 500 }
    );
  }

  await supabase.from("invoice_events").insert({
    company_id: companyId,
    invoice_id: (invoice as SupplierInvoice).id,
    event_type: "created",
    user_id: userId,
    metadata: { source: "manual" },
  });

  return NextResponse.json({ invoice });
}
