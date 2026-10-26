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
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import {
  isExtractedInvoice,
  normalizeExtraction,
  type ExtractedInvoice,
} from "@/lib/restaurant/invoice-extraction";
import { createInvoiceDraft } from "@/lib/restaurant/invoice-draft";
import type { InvoiceSourceType } from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_SOURCES: readonly InvoiceSourceType[] = ["pdf", "image"] as const;

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

  const result = await createInvoiceDraft(supabase, {
    companyId,
    userId,
    extraction,
    sourceType,
    originalFileName,
    strictPrices: false,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "missing_date":
      case "no_lines":
      case "no_usable_lines":
      case "currency_mismatch":
        return NextResponse.json({ error: result.message }, { status: 400 });
      case "lines_failed":
        return NextResponse.json(
          {
            error: result.message,
            details: result.details,
            invoice: result.invoice,
          },
          { status: 500 }
        );
      default:
        return NextResponse.json(
          { error: result.message, details: result.details },
          { status: 500 }
        );
    }
  }

  return NextResponse.json({
    invoice: result.invoice,
    lines_inserted: result.linesInserted,
    auto_matched: result.autoMatched,
    unmatched: result.unmatched,
  });
}
