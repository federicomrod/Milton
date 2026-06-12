// app/api/restaurant/invoices/[id]/approve/route.ts
//
// POST /api/restaurant/invoices/:id/approve
//
// Posts an invoice: walks every approved+matched line and inserts a
// corresponding ingredient_cost_entries row (source_type='invoice_line',
// source_id=supplier_invoice_lines.id), then flips the invoice to
// status='posted'. Lines that aren't approved+matched are skipped and
// returned in `skipped_lines`.
//
// Conditions:
//   * Invoice must belong to the caller's company.
//   * Invoice status must be `draft`, `needs_review`, or `approved`.
//     ('posted' is rejected: an invoice can't be posted twice.)
//   * At least one line must be approved+matched. Otherwise → 400.
//   * For every approved+matched line, the line's unit must be convertible
//     to the matched ingredient's default_unit. Lines where conversion
//     fails are skipped (the line's review_status is left alone) and
//     returned with a reason. The invoice still posts for the rest.
//
// On success, `agent_action`-style audit events are inserted:
//   - one `approved` event when the header transitions
//   - one `posted` event after cost entries are written

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { normalizeUnit, convertUnitPriceStr } from "@/lib/restaurant/units";
import type {
  SupplierInvoice,
  SupplierInvoiceLine,
} from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INVOICE_SELECT =
  "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at";

const LINE_SELECT =
  "id, company_id, invoice_id, supplier_id, ingredient_id, supplier_item_name, supplier_sku, description, quantity, unit, unit_cost, line_total, tax_amount, normalized_unit, normalized_unit_cost, match_status, review_status, notes, created_at, updated_at";

type ApproveSkipped = {
  line_id: string;
  description: string;
  reason: string;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;

  // ---- Load invoice ----
  const { data: invRow, error: invErr } = await supabase
    .from("supplier_invoices")
    .select(INVOICE_SELECT)
    .eq("company_id", companyId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) {
    return NextResponse.json(
      { error: "Invoice lookup failed", details: invErr.message },
      { status: 500 }
    );
  }
  if (!invRow) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  const invoice = invRow as SupplierInvoice;
  if (invoice.status === "posted") {
    return NextResponse.json(
      { error: "Invoice is already posted." },
      { status: 409 }
    );
  }
  if (
    invoice.status !== "draft" &&
    invoice.status !== "needs_review" &&
    invoice.status !== "approved"
  ) {
    return NextResponse.json(
      {
        error: `Invoice cannot be posted from status '${invoice.status}'.`,
      },
      { status: 409 }
    );
  }

  // ---- Load lines + ingredient catalog ----
  const [linesRes, ingRes] = await Promise.all([
    supabase
      .from("supplier_invoice_lines")
      .select(LINE_SELECT)
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId),
    supabase
      .from("ingredients")
      .select("id, default_unit")
      .eq("company_id", companyId),
  ]);
  if (linesRes.error) {
    return NextResponse.json(
      { error: "Line lookup failed", details: linesRes.error.message },
      { status: 500 }
    );
  }
  const lines = (linesRes.data ?? []) as SupplierInvoiceLine[];
  const ingredientById = new Map<string, { default_unit: string | null }>();
  for (const i of (ingRes.data ?? []) as {
    id: string;
    default_unit: string | null;
  }[]) {
    ingredientById.set(i.id, { default_unit: i.default_unit });
  }

  // ---- Filter to postable lines ----
  const postable: SupplierInvoiceLine[] = [];
  const skipped: ApproveSkipped[] = [];

  for (const line of lines) {
    if (line.review_status !== "approved") {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: `Line is ${line.review_status}; only approved lines are posted.`,
      });
      continue;
    }
    if (
      (line.match_status !== "matched" &&
        line.match_status !== "auto_matched") ||
      !line.ingredient_id
    ) {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: "Line is not matched to an ingredient.",
      });
      continue;
    }
    postable.push(line);
  }

  if (postable.length === 0) {
    return NextResponse.json(
      {
        error:
          "No approved + matched lines to post. Approve and match at least one line first.",
        skipped_lines: skipped,
      },
      { status: 400 }
    );
  }

  // ---- Build cost-entry inserts ----
  type CostEntryInsert = {
    company_id: string;
    ingredient_id: string;
    supplier_id: string | null;
    source_type: "invoice_line";
    source_id: string;
    cost_date: string;
    quantity: number;
    unit: string;
    total_cost: number;
    unit_cost: number;
    normalized_unit: string;
    normalized_unit_cost: number;
    currency: string;
    notes: string | null;
  };

  const inserts: CostEntryInsert[] = [];

  for (const line of postable) {
    const ing = ingredientById.get(line.ingredient_id as string);
    const targetUnit = ing?.default_unit || line.unit;
    const unitCost =
      typeof line.unit_cost === "number" &&
      Number.isFinite(line.unit_cost) &&
      line.quantity > 0
        ? line.unit_cost
        : line.quantity > 0
          ? line.line_total / line.quantity
          : null;

    if (unitCost === null) {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: "Could not derive unit_cost (zero quantity or missing total).",
      });
      continue;
    }

    const converted = convertUnitPriceStr(unitCost, line.unit, targetUnit);
    if (!converted.ok) {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: `Cannot convert unit "${line.unit}" to ingredient default unit "${targetUnit}".`,
      });
      continue;
    }
    const normalizedUnit = normalizeUnit(targetUnit) ?? targetUnit;

    inserts.push({
      company_id: companyId,
      ingredient_id: line.ingredient_id as string,
      supplier_id: line.supplier_id ?? invoice.supplier_id,
      source_type: "invoice_line",
      source_id: line.id,
      cost_date: invoice.invoice_date,
      quantity: line.quantity,
      unit: line.unit,
      total_cost: line.line_total,
      unit_cost: unitCost,
      normalized_unit: normalizedUnit,
      normalized_unit_cost: converted.value,
      currency: invoice.currency,
      notes:
        line.notes ??
        (invoice.invoice_number
          ? `From invoice ${invoice.invoice_number}`
          : null),
    });
  }

  if (inserts.length === 0) {
    return NextResponse.json(
      {
        error: "No postable lines remained after unit conversion checks.",
        skipped_lines: skipped,
      },
      { status: 400 }
    );
  }

  // ---- Persist cost entries ----
  const { data: insertedCostEntries, error: insErr } = await supabase
    .from("ingredient_cost_entries")
    .insert(inserts)
    .select("id, ingredient_id, source_id");
  if (insErr) {
    console.error("[invoices/approve] cost entry insert:", insErr.message);
    return NextResponse.json(
      {
        error: "Could not write ingredient_cost_entries",
        details: insErr.message,
      },
      { status: 500 }
    );
  }
  const insertedCount = insertedCostEntries?.length ?? 0;

  // Also fold each line's resolved normalized values back into the line so
  // the UI shows them post-approval.
  for (const line of postable) {
    const inserted = (insertedCostEntries ?? []).find(
      (e: { source_id: string }) => e.source_id === line.id
    );
    if (!inserted) continue; // line was skipped during conversion above
    const ing = ingredientById.get(line.ingredient_id as string);
    const targetUnit = ing?.default_unit || line.unit;
    const normalizedUnit = normalizeUnit(targetUnit) ?? targetUnit;
    const unitCost =
      typeof line.unit_cost === "number" &&
      Number.isFinite(line.unit_cost) &&
      line.quantity > 0
        ? line.unit_cost
        : line.line_total / line.quantity;
    const converted = convertUnitPriceStr(unitCost, line.unit, targetUnit);
    if (!converted.ok) continue;
    await supabase
      .from("supplier_invoice_lines")
      .update({
        normalized_unit: normalizedUnit,
        normalized_unit_cost: converted.value,
        unit_cost: unitCost,
      })
      .eq("company_id", companyId)
      .eq("id", line.id);
  }

  // ---- Transition invoice → posted ----
  const nowIso = new Date().toISOString();
  const { data: updatedInvoice, error: invUpdErr } = await supabase
    .from("supplier_invoices")
    .update({
      status: "posted",
      approved_by_user_id: userId,
      approved_at: nowIso,
    })
    .eq("company_id", companyId)
    .eq("id", invoiceId)
    .select(INVOICE_SELECT)
    .single();
  if (invUpdErr || !updatedInvoice) {
    console.error("[invoices/approve] invoice update:", invUpdErr?.message);
    return NextResponse.json(
      {
        error:
          "Cost entries were written but the invoice could not be marked posted.",
        details: invUpdErr?.message,
        inserted_cost_entries: insertedCount,
      },
      { status: 500 }
    );
  }

  // ---- Audit events ----
  await supabase.from("invoice_events").insert([
    {
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "approved",
      user_id: userId,
      metadata: {
        lines_postable: postable.length,
        lines_skipped: skipped.length,
      },
    },
    {
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "posted",
      user_id: userId,
      metadata: {
        cost_entries_written: insertedCount,
        skipped_lines: skipped.length,
      },
    },
  ]);

  return NextResponse.json({
    invoice: updatedInvoice,
    posted_lines: insertedCount,
    skipped_lines: skipped,
    /** CTA copy for the UI. */
    next_steps:
      "Invoice posted. Run Supplier Agent and Recipe & Margin Agent to detect price and margin changes.",
  });
}
