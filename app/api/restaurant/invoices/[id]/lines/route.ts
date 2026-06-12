// app/api/restaurant/invoices/[id]/lines/route.ts
//
// POST /api/restaurant/invoices/:id/lines
//
// Two modes (discriminated by body shape):
//
//   1) Add a NEW line — body has no `line_id`:
//      {
//        description, quantity, unit,
//        unit_cost?, line_total, tax_amount?,
//        supplier_item_name?, supplier_sku?,
//        ingredient_id?, notes?
//      }
//      Inserts a new supplier_invoice_lines row in review_status='pending'
//      and match_status derived from whether ingredient_id was supplied.
//
//   2) UPDATE an existing line — body includes `line_id`:
//      {
//        line_id,
//        ingredient_id?: string | null,  // null = unmatch
//        review_status?: 'pending'|'approved'|'rejected',
//        notes?: string,
//        // editable fields (only set when explicitly provided):
//        description?, quantity?, unit?, unit_cost?, line_total?,
//        tax_amount?, supplier_item_name?, supplier_sku?
//      }
//
// Invoice header's status is left alone except when at least one line is
// reviewed (approved/rejected) — in that case the header is bumped from
// 'draft' to 'needs_review' so the list page shows the in-progress state.
//
// All cost-entry writes are deferred to /invoices/:id/approve.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  isInvoiceLineReviewStatus,
  type SupplierInvoice,
  type SupplierInvoiceLine,
  type InvoiceLineMatchStatus,
  type InvoiceLineReviewStatus,
} from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LINE_SELECT =
  "id, company_id, invoice_id, supplier_id, ingredient_id, supplier_item_name, supplier_sku, description, quantity, unit, unit_cost, line_total, tax_amount, normalized_unit, normalized_unit_cost, match_status, review_status, notes, created_at, updated_at";

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // Verify the invoice exists for this company.
  const { data: invRow, error: invErr } = await supabase
    .from("supplier_invoices")
    .select("id, supplier_id, status, currency")
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
  const invoice = invRow as Pick<
    SupplierInvoice,
    "id" | "supplier_id" | "status" | "currency"
  >;

  // Refuse mutations once an invoice is posted.
  if (invoice.status === "posted") {
    return NextResponse.json(
      { error: "Invoice is already posted; lines are read-only." },
      { status: 409 }
    );
  }

  // ---- Mode 2: update an existing line ----
  if (typeof body.line_id === "string" && body.line_id !== "") {
    const lineId = body.line_id;

    // Load the existing row so we know what to patch (and to validate
    // company scope explicitly even though RLS would catch it).
    const { data: existing, error: lineLoadErr } = await supabase
      .from("supplier_invoice_lines")
      .select(LINE_SELECT)
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId)
      .eq("id", lineId)
      .maybeSingle();
    if (lineLoadErr) {
      return NextResponse.json(
        { error: "Line lookup failed", details: lineLoadErr.message },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 });
    }
    const line = existing as SupplierInvoiceLine;

    const patch: Record<string, unknown> = {};
    let reviewChanged = false;

    if (Object.prototype.hasOwnProperty.call(body, "ingredient_id")) {
      // Allow explicit unmatch via ingredient_id === null.
      const next = body.ingredient_id;
      if (next === null) {
        patch.ingredient_id = null;
        patch.match_status = "unmatched" as InvoiceLineMatchStatus;
      } else if (typeof next === "string" && next !== "") {
        patch.ingredient_id = next;
        patch.match_status = "matched" as InvoiceLineMatchStatus;
      } else {
        return NextResponse.json(
          { error: "ingredient_id must be a string or null" },
          { status: 400 }
        );
      }
    }

    if (typeof body.review_status === "string") {
      if (!isInvoiceLineReviewStatus(body.review_status)) {
        return NextResponse.json(
          { error: "review_status must be pending, approved, or rejected" },
          { status: 400 }
        );
      }
      patch.review_status = body.review_status as InvoiceLineReviewStatus;
      reviewChanged = body.review_status !== line.review_status;
    }

    // ---- Inline new_ingredient on an existing line ----
    //
    // The new-line branch already accepts {new_ingredient: {name, default_unit,
    // category?}}; mirror that here so an unmatched line can create + match
    // an ingredient in one round-trip. We dedupe against existing ingredient
    // names (case-insensitive) to avoid spawning a near-duplicate row, and
    // we upsert the supplier_ingredients link when the invoice has a
    // supplier so future invoices auto-match by SKU / item name.
    //
    // Skipped when the caller also sent an explicit ingredient_id — that
    // path already covers the user's intent unambiguously.
    let createdIngredient: { id: string; name: string } | null = null;
    const newIngredientRaw =
      !Object.prototype.hasOwnProperty.call(body, "ingredient_id") &&
      body.new_ingredient &&
      typeof body.new_ingredient === "object"
        ? (body.new_ingredient as Record<string, unknown>)
        : null;
    if (newIngredientRaw) {
      const newName = stringOrNull(newIngredientRaw.name);
      if (!newName) {
        return NextResponse.json(
          { error: "new_ingredient.name is required" },
          { status: 400 }
        );
      }
      const newDefaultUnit =
        stringOrNull(newIngredientRaw.default_unit) ?? line.unit;
      if (!newDefaultUnit) {
        return NextResponse.json(
          { error: "new_ingredient.default_unit is required" },
          { status: 400 }
        );
      }
      const newCategory = stringOrNull(newIngredientRaw.category);

      // Reuse an existing ingredient with the same name to avoid duplicates.
      const { data: existingIng, error: lookupErr } = await supabase
        .from("ingredients")
        .select("id, name")
        .eq("company_id", companyId)
        .ilike("name", newName)
        .limit(1);
      if (lookupErr) {
        return NextResponse.json(
          { error: "Ingredient lookup failed", details: lookupErr.message },
          { status: 500 }
        );
      }

      let ingredientId: string;
      if (existingIng && existingIng.length > 0) {
        ingredientId = (existingIng[0] as { id: string }).id;
      } else {
        const { data: createdIng, error: createErr } = await supabase
          .from("ingredients")
          .insert({
            company_id: companyId,
            name: newName,
            category: newCategory,
            default_unit: newDefaultUnit,
            current_unit_cost: 0,
            currency: "MXN",
          })
          .select("id, name")
          .single();
        if (createErr || !createdIng) {
          return NextResponse.json(
            {
              error: "Could not create ingredient",
              details: createErr?.message,
            },
            { status: 500 }
          );
        }
        ingredientId = (createdIng as { id: string }).id;
        createdIngredient = createdIng as { id: string; name: string };
      }

      patch.ingredient_id = ingredientId;
      patch.match_status = "matched" as InvoiceLineMatchStatus;

      // Upsert supplier_ingredients so the next invoice from this supplier
      // auto-matches the same SKU/item name to this ingredient.
      // Prefer freshly-supplied identifiers (body) over the stored line.
      const supplierId = line.supplier_id ?? invoice.supplier_id;
      const supplierItemName = Object.prototype.hasOwnProperty.call(
        body,
        "supplier_item_name"
      )
        ? stringOrNull(body.supplier_item_name)
        : line.supplier_item_name;
      const supplierSku = Object.prototype.hasOwnProperty.call(
        body,
        "supplier_sku"
      )
        ? stringOrNull(body.supplier_sku)
        : line.supplier_sku;
      if (supplierId) {
        const { error: linkErr } = await supabase
          .from("supplier_ingredients")
          .upsert(
            {
              company_id: companyId,
              supplier_id: supplierId,
              ingredient_id: ingredientId,
              supplier_item_name: supplierItemName,
              supplier_sku: supplierSku,
            },
            { onConflict: "company_id,supplier_id,ingredient_id" }
          );
        if (linkErr) {
          // Non-fatal: log but let the line save with the matched id.
          console.error(
            "[invoices/lines] supplier_ingredients upsert:",
            linkErr.message
          );
        }
      }
    }

    if (typeof body.notes === "string") patch.notes = body.notes;
    if (
      typeof body.description === "string" &&
      body.description.trim() !== ""
    ) {
      patch.description = body.description.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "quantity")) {
      const q = numberOrNull(body.quantity);
      if (q === null || q <= 0) {
        return NextResponse.json(
          { error: "quantity must be a positive number" },
          { status: 400 }
        );
      }
      patch.quantity = q;
    }
    if (typeof body.unit === "string" && body.unit.trim() !== "") {
      patch.unit = body.unit.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "unit_cost")) {
      const uc = numberOrNull(body.unit_cost);
      patch.unit_cost = uc !== null && uc >= 0 ? uc : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "line_total")) {
      const lt = numberOrNull(body.line_total);
      if (lt === null || lt < 0) {
        return NextResponse.json(
          { error: "line_total must be a non-negative number" },
          { status: 400 }
        );
      }
      patch.line_total = lt;
    }
    if (Object.prototype.hasOwnProperty.call(body, "tax_amount")) {
      const ta = numberOrNull(body.tax_amount);
      patch.tax_amount = ta !== null && ta >= 0 ? ta : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "supplier_item_name")) {
      patch.supplier_item_name = stringOrNull(body.supplier_item_name);
    }
    if (Object.prototype.hasOwnProperty.call(body, "supplier_sku")) {
      patch.supplier_sku = stringOrNull(body.supplier_sku);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data: updated, error: updErr } = await supabase
      .from("supplier_invoice_lines")
      .update(patch)
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId)
      .eq("id", lineId)
      .select(LINE_SELECT)
      .single();
    if (updErr || !updated) {
      return NextResponse.json(
        { error: "Update failed", details: updErr?.message },
        { status: 500 }
      );
    }

    // Audit events for the per-line state machine.
    if (reviewChanged && patch.review_status === "approved") {
      await supabase.from("invoice_events").insert({
        company_id: companyId,
        invoice_id: invoiceId,
        event_type: "line_approved",
        user_id: userId,
        metadata: { line_id: lineId },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, "ingredient_id") &&
      patch.ingredient_id !== null
    ) {
      await supabase.from("invoice_events").insert({
        company_id: companyId,
        invoice_id: invoiceId,
        event_type: "line_matched",
        user_id: userId,
        metadata: { line_id: lineId, ingredient_id: patch.ingredient_id },
      });
    }

    // Bump invoice from draft → needs_review on first review action.
    if (reviewChanged && invoice.status === "draft") {
      await supabase
        .from("supplier_invoices")
        .update({ status: "needs_review" })
        .eq("company_id", companyId)
        .eq("id", invoiceId);
    }

    return NextResponse.json({
      line: updated,
      created_ingredient: createdIngredient,
    });
  }

  // ---- Mode 1: add a new line ----
  const description = stringOrNull(body.description);
  if (!description) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 }
    );
  }
  const quantity = numberOrNull(body.quantity);
  if (quantity === null || quantity <= 0) {
    return NextResponse.json(
      { error: "quantity must be a positive number" },
      { status: 400 }
    );
  }
  const unit = stringOrNull(body.unit);
  if (!unit) {
    return NextResponse.json({ error: "unit is required" }, { status: 400 });
  }
  const lineTotal = numberOrNull(body.line_total);
  if (lineTotal === null || lineTotal < 0) {
    return NextResponse.json(
      { error: "line_total must be a non-negative number" },
      { status: 400 }
    );
  }
  const unitCostRaw = numberOrNull(body.unit_cost);
  const unitCost =
    unitCostRaw !== null && unitCostRaw >= 0
      ? unitCostRaw
      : quantity > 0
        ? lineTotal / quantity
        : null;
  const taxAmount = numberOrNull(body.tax_amount);

  // ---- Resolve / create the ingredient ----
  // Three possible inputs (mutually exclusive, processed in order):
  //   * body.ingredient_id  → existing ingredient
  //   * body.new_ingredient → { name, default_unit, category? } → create one
  //   * neither             → line stays unmatched
  let ingredientId = stringOrNull(body.ingredient_id);
  let createdIngredient: { id: string; name: string } | null = null;

  const newIngredientRaw =
    body.new_ingredient && typeof body.new_ingredient === "object"
      ? (body.new_ingredient as Record<string, unknown>)
      : null;

  if (!ingredientId && newIngredientRaw) {
    const newName = stringOrNull(newIngredientRaw.name);
    if (!newName) {
      return NextResponse.json(
        { error: "new_ingredient.name is required" },
        { status: 400 }
      );
    }
    const newDefaultUnit = stringOrNull(newIngredientRaw.default_unit) ?? unit; // fall back to the line's unit
    const newCategory = stringOrNull(newIngredientRaw.category);

    // Reuse an existing ingredient if one already exists with this name
    // (case-insensitive). Avoids duplicate rows when the user types a name
    // that's already in the catalog instead of picking it from the dropdown.
    const { data: existing, error: lookupErr } = await supabase
      .from("ingredients")
      .select("id, name")
      .eq("company_id", companyId)
      .ilike("name", newName)
      .limit(1);
    if (lookupErr) {
      return NextResponse.json(
        { error: "Ingredient lookup failed", details: lookupErr.message },
        { status: 500 }
      );
    }
    if (existing && existing.length > 0) {
      ingredientId = (existing[0] as { id: string }).id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("ingredients")
        .insert({
          company_id: companyId,
          name: newName,
          category: newCategory,
          default_unit: newDefaultUnit,
          current_unit_cost: 0,
          currency: invoice.currency ?? "MXN",
        })
        .select("id, name")
        .single();
      if (createErr || !created) {
        return NextResponse.json(
          {
            error: "Could not create ingredient",
            details: createErr?.message,
          },
          { status: 500 }
        );
      }
      ingredientId = (created as { id: string }).id;
      createdIngredient = created as { id: string; name: string };
    }
  }

  // Upsert the supplier ↔ ingredient link when we have both sides plus any
  // supplier-side identifiers from the line. Mirrors how bulk cost upload
  // maintains supplier_ingredients.
  const supplierItemName = stringOrNull(body.supplier_item_name);
  const supplierSku = stringOrNull(body.supplier_sku);
  if (ingredientId && invoice.supplier_id) {
    const { error: linkErr } = await supabase
      .from("supplier_ingredients")
      .upsert(
        {
          company_id: companyId,
          supplier_id: invoice.supplier_id,
          ingredient_id: ingredientId,
          supplier_item_name: supplierItemName,
          supplier_sku: supplierSku,
        },
        { onConflict: "company_id,supplier_id,ingredient_id" }
      );
    if (linkErr) {
      // Non-fatal: log but still let the line save with the matched id.
      console.error(
        "[invoices/lines] supplier_ingredients upsert:",
        linkErr.message
      );
    }
  }

  const insertRow = {
    company_id: companyId,
    invoice_id: invoiceId,
    supplier_id: invoice.supplier_id,
    ingredient_id: ingredientId,
    supplier_item_name: supplierItemName,
    supplier_sku: supplierSku,
    description,
    quantity,
    unit,
    unit_cost: unitCost,
    line_total: lineTotal,
    tax_amount: taxAmount !== null && taxAmount >= 0 ? taxAmount : null,
    match_status: (ingredientId
      ? "matched"
      : "unmatched") as InvoiceLineMatchStatus,
    review_status: "pending" as InvoiceLineReviewStatus,
    notes: stringOrNull(body.notes),
  };

  const { data: created, error: createErr } = await supabase
    .from("supplier_invoice_lines")
    .insert(insertRow)
    .select(LINE_SELECT)
    .single();
  if (createErr || !created) {
    return NextResponse.json(
      { error: "Could not create line", details: createErr?.message },
      { status: 500 }
    );
  }

  if (ingredientId) {
    await supabase.from("invoice_events").insert({
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "line_matched",
      user_id: userId,
      metadata: {
        line_id: (created as SupplierInvoiceLine).id,
        ingredient_id: ingredientId,
        ingredient_created: createdIngredient ? true : undefined,
      },
    });
  }

  return NextResponse.json({
    line: created,
    created_ingredient: createdIngredient,
  });
}
