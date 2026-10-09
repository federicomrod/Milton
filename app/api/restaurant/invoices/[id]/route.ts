// app/api/restaurant/invoices/[id]/route.ts
//
// GET /api/restaurant/invoices/:id
//   Returns the invoice header, all its lines, the linked supplier name, the
//   invoice's event timeline, and the ingredient catalog for the company so
//   the review UI can show a match dropdown without an extra round-trip.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { fetchAllRows, warnIfTruncated } from "@/lib/restaurant/paginated-read";
import type {
  SupplierInvoice,
  SupplierInvoiceLine,
  InvoiceEvent,
} from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INVOICE_SELECT =
  "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at";

const LINE_SELECT =
  "id, company_id, invoice_id, supplier_id, ingredient_id, supplier_item_name, supplier_sku, description, quantity, unit, unit_cost, line_total, tax_amount, normalized_unit, normalized_unit_cost, match_status, review_status, notes, created_at, updated_at";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const [invRes, lineRes, evtRes, ingRes] = await Promise.all([
    supabase
      .from("supplier_invoices")
      .select(INVOICE_SELECT)
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    fetchAllRows<SupplierInvoiceLine>(() =>
      supabase
        .from("supplier_invoice_lines")
        .select(LINE_SELECT)
        .eq("company_id", companyId)
        .eq("invoice_id", id)
    ),
    supabase
      .from("invoice_events")
      .select(
        "id, company_id, invoice_id, event_type, user_id, note, metadata, created_at"
      )
      .eq("company_id", companyId)
      .eq("invoice_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
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
  ]);

  if (invRes.error) {
    return NextResponse.json(
      { error: "Invoice lookup failed", details: invRes.error.message },
      { status: 500 }
    );
  }
  if (!invRes.data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (lineRes.error) {
    return NextResponse.json(
      { error: "Invoice lines lookup failed", details: lineRes.error.message },
      { status: 500 }
    );
  }
  warnIfTruncated("invoice detail lines", lineRes);
  const invoice = invRes.data as SupplierInvoice;

  let supplierName: string | null = null;
  if (invoice.supplier_id) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("name")
      .eq("company_id", companyId)
      .eq("id", invoice.supplier_id)
      .maybeSingle();
    supplierName = (supplier as { name?: string } | null)?.name ?? null;
  }

  return NextResponse.json({
    invoice: { ...invoice, supplier_name: supplierName },
    lines: [...lineRes.rows].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    ),
    events: (evtRes.data ?? []) as InvoiceEvent[],
    ingredients: [...ingRes.rows].sort((a, b) => a.name.localeCompare(b.name)),
  });
}
