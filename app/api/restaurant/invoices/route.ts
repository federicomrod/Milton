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
import {
  isInvoiceStatus,
  type SupplierInvoice,
} from "@/types/supplier-invoices";

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
  const { data: invoices, error } = await query;
  if (error) {
    console.error("[invoices GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }

  // Pull aggregated line counts in one round-trip so the list can show
  // "matched / total" progress without a per-row query.
  const ids = (invoices ?? []).map((i) => (i as SupplierInvoice).id);
  type LineRow = {
    invoice_id: string;
    match_status: string;
    review_status: string;
  };
  let linesByInvoice = new Map<
    string,
    {
      total: number;
      matched: number;
      approved: number;
      unmatched: number;
      pending: number;
    }
  >();
  if (ids.length > 0) {
    const { data: lines, error: linesErr } = await supabase
      .from("supplier_invoice_lines")
      .select("invoice_id, match_status, review_status")
      .eq("company_id", companyId)
      .in("invoice_id", ids);
    if (linesErr) {
      console.error("[invoices GET] line counts:", linesErr.message);
    } else {
      linesByInvoice = new Map();
      for (const id of ids) {
        linesByInvoice.set(id, {
          total: 0,
          matched: 0,
          approved: 0,
          unmatched: 0,
          pending: 0,
        });
      }
      for (const l of (lines ?? []) as LineRow[]) {
        const bucket = linesByInvoice.get(l.invoice_id);
        if (!bucket) continue;
        bucket.total++;
        if (l.match_status === "matched" || l.match_status === "auto_matched") {
          bucket.matched++;
        }
        if (l.match_status === "unmatched") bucket.unmatched++;
        if (l.review_status === "approved") bucket.approved++;
        if (l.review_status === "pending") bucket.pending++;
      }
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
    const counts = linesByInvoice.get(inv.id) ?? {
      total: 0,
      matched: 0,
      approved: 0,
      unmatched: 0,
      pending: 0,
    };
    return {
      ...inv,
      supplier_name: inv.supplier_id
        ? (supplierNameById.get(inv.supplier_id) ?? null)
        : null,
      line_counts: counts,
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

  const currency =
    typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
      ? body.currency
      : "MXN";

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
