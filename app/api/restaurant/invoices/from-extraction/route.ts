// app/api/restaurant/invoices/from-extraction/route.ts
//
// POST /api/restaurant/invoices/from-extraction
//
// Accepts the (potentially user-edited) draft produced by
// /api/restaurant/invoices/extract and creates a real supplier_invoices
// header + supplier_invoice_lines. Auto-matches lines against the
// company's ingredient catalog and supplier_ingredients links via the
// same helper used by the CSV/XLSX uploader. Does NOT post the invoice
// or write any ingredient_cost_entries — the invoice lands in
// status='needs_review' for the human to approve in the normal flow.
//
// Body:
//   {
//     extraction:        ExtractedInvoice,
//     original_file_name?: string,
//     source_type?:      "pdf" | "image"   // defaults to "image"
//   }

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  isExtractedInvoice,
  normalizeExtraction,
  type ExtractedInvoice,
} from "@/lib/restaurant/invoice-extraction";
import {
  matchIngredientForLine,
  type IngredientCatalogEntry,
  type SupplierIngredientLink,
} from "@/lib/restaurant/invoice-import";
import type {
  InvoiceLineMatchStatus,
  InvoiceSourceType,
} from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INVOICE_SELECT =
  "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at";

const ALLOWED_SOURCES: readonly InvoiceSourceType[] = ["pdf", "image"] as const;

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
  if (!isExtractedInvoice(body.extraction)) {
    return NextResponse.json(
      {
        error:
          "extraction did not match the invoice extraction schema. Re-run extract or edit the draft.",
      },
      { status: 400 }
    );
  }
  const extraction: ExtractedInvoice = normalizeExtraction(body.extraction);

  const sourceTypeRaw =
    typeof body.source_type === "string" ? body.source_type : "image";
  const sourceType: InvoiceSourceType = (
    ALLOWED_SOURCES as readonly string[]
  ).includes(sourceTypeRaw)
    ? (sourceTypeRaw as InvoiceSourceType)
    : "image";
  const originalFileName =
    typeof body.original_file_name === "string"
      ? body.original_file_name
      : null;

  // ---- Header validation ----
  if (!extraction.invoice_date) {
    return NextResponse.json(
      {
        error:
          "invoice_date is required to create an invoice. Edit the draft to add a date before saving.",
      },
      { status: 400 }
    );
  }
  if (extraction.lines.length === 0) {
    return NextResponse.json(
      { error: "At least one line is required." },
      { status: 400 }
    );
  }

  const currency =
    extraction.currency && /^[A-Z]{3}$/.test(extraction.currency)
      ? extraction.currency
      : "MXN";

  // ---- Resolve / autocreate supplier ----
  let supplierId: string | null = null;
  if (extraction.supplier_name && extraction.supplier_name.trim() !== "") {
    const supplierName = extraction.supplier_name.trim();
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

  // ---- Ingredient catalog + supplier links (for auto-match) ----
  const { data: catalogRows } = await supabase
    .from("ingredients")
    .select("id, name, default_unit")
    .eq("company_id", companyId);
  const ingredientCatalog: IngredientCatalogEntry[] = (catalogRows ??
    []) as IngredientCatalogEntry[];

  const { data: linkRows } = await supabase
    .from("supplier_ingredients")
    .select("supplier_id, ingredient_id, supplier_item_name, supplier_sku")
    .eq("company_id", companyId);
  const supplierLinks: SupplierIngredientLink[] = (linkRows ??
    []) as SupplierIngredientLink[];

  // ---- Insert invoice header ----
  let subtotal = extraction.subtotal;
  if (subtotal === null) {
    let acc = 0;
    let allKnown = true;
    for (const line of extraction.lines) {
      if (line.line_total === null) {
        allKnown = false;
        break;
      }
      acc += line.line_total;
    }
    subtotal = allKnown ? acc : null;
  }
  const taxAmount = extraction.tax_amount;
  const totalAmount =
    extraction.total_amount !== null
      ? extraction.total_amount
      : subtotal !== null
        ? subtotal + (taxAmount ?? 0)
        : null;

  const { data: inserted, error: invErr } = await supabase
    .from("supplier_invoices")
    .insert({
      company_id: companyId,
      supplier_id: supplierId,
      invoice_number: extraction.invoice_number,
      invoice_date: extraction.invoice_date,
      due_date: extraction.due_date,
      currency,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: "needs_review",
      source_type: sourceType,
      original_file_name: originalFileName,
      created_by_user_id: userId,
      notes:
        extraction.confidence_notes.length > 0
          ? `AI extraction notes: ${extraction.confidence_notes.join(" · ")}`
          : null,
    })
    .select(INVOICE_SELECT)
    .single();
  if (invErr || !inserted) {
    return NextResponse.json(
      { error: "Could not create invoice", details: invErr?.message },
      { status: 500 }
    );
  }
  const invoiceId = (inserted as { id: string }).id;

  // ---- Build line inserts with auto-matching ----
  let autoMatched = 0;
  let unmatched = 0;
  const lineInserts = extraction.lines.map((line) => {
    const match = matchIngredientForLine(
      {
        ingredient_name: null, // OpenAI does not return ingredient_name; matching by item-name / sku only
        supplier_item_name: line.supplier_item_name,
        supplier_sku: line.supplier_sku,
        supplier_id: supplierId,
      },
      ingredientCatalog,
      supplierLinks
    );
    const matchStatus: InvoiceLineMatchStatus = match
      ? "auto_matched"
      : "unmatched";
    if (match) autoMatched++;
    else unmatched++;
    // Derive unit_cost if missing but quantity + line_total are present.
    const unitCost =
      line.unit_cost !== null && line.unit_cost >= 0
        ? line.unit_cost
        : line.quantity !== null &&
            line.quantity > 0 &&
            line.line_total !== null
          ? line.line_total / line.quantity
          : null;
    return {
      company_id: companyId,
      invoice_id: invoiceId,
      supplier_id: supplierId,
      ingredient_id: match?.ingredient_id ?? null,
      supplier_item_name: line.supplier_item_name,
      supplier_sku: line.supplier_sku,
      description: line.description,
      // Schema requires positive quantity; coerce to 1 when missing so the
      // line can still be created and the user can fix it.
      quantity: line.quantity !== null && line.quantity > 0 ? line.quantity : 1,
      unit: line.unit ?? "unit",
      unit_cost: unitCost,
      line_total: line.line_total !== null ? line.line_total : 0,
      tax_amount: line.tax_amount,
      match_status: matchStatus,
      review_status: "pending" as const,
    };
  });

  const { error: linesErr, count } = await supabase
    .from("supplier_invoice_lines")
    .insert(lineInserts, { count: "exact" });
  if (linesErr) {
    // Surface but don't roll back the invoice — the user can re-enter lines
    // manually if necessary, and the header carries the AI notes.
    console.error("[invoices/from-extraction] line insert:", linesErr.message);
    return NextResponse.json(
      {
        error: "Invoice header created but line insert failed.",
        details: linesErr.message,
        invoice: inserted,
      },
      { status: 500 }
    );
  }

  // ---- Audit events ----
  await supabase.from("invoice_events").insert([
    {
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "uploaded",
      user_id: userId,
      metadata: {
        source: sourceType,
        file_name: originalFileName,
        ai_extraction: true,
        line_count: lineInserts.length,
        auto_matched: autoMatched,
        unmatched,
        confidence_notes: extraction.confidence_notes,
      },
    },
    {
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "created",
      user_id: userId,
      metadata: { source: "ai_extraction" },
    },
  ]);

  return NextResponse.json({
    invoice: inserted,
    lines_inserted: count ?? lineInserts.length,
    auto_matched: autoMatched,
    unmatched,
  });
}
