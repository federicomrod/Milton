// lib/restaurant/invoice-draft.ts
//
// Shared pieces of the "invoice photo -> needs_review draft" flow.
//
//   * extractInvoiceFromImage  — the OpenAI vision call (was local to
//     /api/restaurant/invoices/extract). Typed failures, own timeout.
//   * createInvoiceDraft       — the insert logic (was local to
//     /api/restaurant/invoices/from-extraction). Two modes:
//       - strictPrices:false  the original behaviour (coerces a missing
//                             quantity to 1, unit to "unit", total to 0).
//       - strictPrices:true   never invents a number: a line without a real
//                             price or quantity is NOT inserted; its
//                             description goes into the invoice notes.
//   * invoiceExistsForKitchenReport — idempotency guard for the Telegram path.
//   * PRICE_UPDATE_NOTE_PREFIX — marks drafts that are price updates.
//
// Nothing here writes ingredient_cost_entries: the invoice always lands in
// status 'needs_review' and a human approves it in the normal flow.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_INSTRUCTION,
  enrichExtraction,
  isExtractedInvoice,
  normalizeExtraction,
  type EnrichedInvoice,
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
import {
  currencyMismatchReason,
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";

export { PRICE_UPDATE_NOTE_PREFIX };

export const DEFAULT_FALLBACK_DATE_NOTE =
  "Fecha no leída en la foto: se usó la fecha de envío por Telegram";

export const DEFAULT_VISION_TIMEOUT_MS = 40_000;

// ---------------------------------------------------------------------------
// Vision call
// ---------------------------------------------------------------------------

export type ExtractFailureReason =
  | "no_api_key"
  | "sdk_unavailable"
  | "timeout"
  | "upstream"
  | "unreadable";

export type ExtractInvoiceResult =
  | { ok: true; extraction: EnrichedInvoice }
  | { ok: false; reason: ExtractFailureReason; message: string };

export interface ExtractInvoiceOptions {
  /** data:<mime>;base64,... of the invoice image. */
  dataUrl: string;
  /** Optional caller signal; aborting it reports reason "timeout"-like upstream. */
  signal?: AbortSignal;
  /** Own timeout. Default 40 s. */
  timeoutMs?: number;
}

export async function extractInvoiceFromImage(
  opts: ExtractInvoiceOptions
): Promise<ExtractInvoiceResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      reason: "no_api_key",
      message: "OpenAI API key is not configured on the server.",
    };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch {
    console.error("[invoice-draft] openai sdk import failed");
    return {
      ok: false,
      reason: "sdk_unavailable",
      message: "Could not load OpenAI SDK on the server.",
    };
  }
  if (!OpenAIctor) {
    return {
      ok: false,
      reason: "sdk_unavailable",
      message: "OpenAI SDK is unavailable.",
    };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({ apiKey: process.env.OPENAI_API_KEY });

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_VISION_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACTION_USER_INSTRUCTION },
              {
                type: "image_url",
                image_url: { url: opts.dataUrl, detail: "high" },
              },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return {
        ok: false,
        reason: "unreadable",
        message: "Model returned no content.",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        reason: "unreadable",
        message: "Model output was not valid JSON. Try a clearer image.",
      };
    }
    if (!isExtractedInvoice(parsed)) {
      return {
        ok: false,
        reason: "unreadable",
        message: "Model output did not match the invoice extraction schema.",
      };
    }
    // Enrich with per-line flags + cheap derivations (missing_*, derived_*,
    // low_confidence).
    return {
      ok: true,
      extraction: enrichExtraction(normalizeExtraction(parsed)),
    };
  } catch (err) {
    if (timedOut) {
      console.error("[invoice-draft] openai call timed out");
      return {
        ok: false,
        reason: "timeout",
        message: "OpenAI call failed: request timed out",
      };
    }
    const msg = err instanceof Error ? err.message : "Unknown OpenAI error";
    console.error("[invoice-draft] openai call failed:", msg);
    return {
      ok: false,
      reason: "upstream",
      message: `OpenAI call failed: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

// ---------------------------------------------------------------------------
// Draft creation
// ---------------------------------------------------------------------------

const INVOICE_SELECT =
  "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at";

export interface CreateInvoiceDraftInput {
  companyId: string;
  /** null when no user is behind the write (Telegram). */
  userId: string | null;
  extraction: ExtractedInvoice;
  sourceType: InvoiceSourceType;
  originalFileName: string | null;
  /** Put FIRST in the invoice notes (e.g. PRICE_UPDATE_NOTE_PREFIX). */
  extraNotes?: string | null;
  /** Merged into the metadata of the "uploaded" and "created" events. */
  eventMetadata?: Record<string, unknown>;
  /** true: never coerce a missing price/quantity/unit (see file header). */
  strictPrices: boolean;
  /** YYYY-MM-DD used when the photo has no date (strict mode only). */
  fallbackInvoiceDate?: string;
  fallbackDateNote?: string;
}

export interface SkippedLine {
  description: string;
  reason: "no_price" | "no_quantity" | "no_unit";
}

export type CreateInvoiceDraftResult =
  | {
      ok: true;
      invoiceId: string;
      /** The inserted supplier_invoices row (INVOICE_SELECT columns). */
      invoice: Record<string, unknown>;
      linesInserted: number;
      autoMatched: number;
      unmatched: number;
      linesSkipped: SkippedLine[];
      supplierId: string | null;
      supplierName: string | null;
      invoiceDate: string;
      usedFallbackDate: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing_date"
        | "no_lines"
        | "no_usable_lines"
        | "currency_mismatch"
        | "supplier_failed"
        | "invoice_failed"
        | "lines_failed";
      message: string;
      details?: string;
      /** Only for lines_failed: the header that was created. */
      invoice?: Record<string, unknown>;
    };

type Client = Pick<SupabaseClient, "from">;

interface PlannedLine {
  line: ExtractedInvoice["lines"][number];
  matchIngredientId: string | null;
  matched: boolean;
  unit: string;
  quantity: number;
  unitCost: number | null;
  lineTotal: number;
}

export async function createInvoiceDraft(
  client: Client,
  input: CreateInvoiceDraftInput
): Promise<CreateInvoiceDraftResult> {
  const supabase = client as SupabaseClient;
  const { companyId, userId, extraction, sourceType, originalFileName } = input;
  const strict = input.strictPrices;

  // ---- Header validation ----
  let invoiceDate = extraction.invoice_date;
  let usedFallbackDate = false;
  if (!invoiceDate) {
    if (strict && input.fallbackInvoiceDate) {
      invoiceDate = input.fallbackInvoiceDate;
      usedFallbackDate = true;
    } else {
      return {
        ok: false,
        reason: "missing_date",
        message:
          "invoice_date is required to create an invoice. Edit the draft to add a date before saving.",
      };
    }
  }
  if (extraction.lines.length === 0) {
    return strict
      ? {
          ok: false,
          reason: "no_usable_lines",
          message: "No usable lines.",
        }
      : {
          ok: false,
          reason: "no_lines",
          message: "At least one line is required.",
        };
  }

  const companyCurrency = await resolveCompanyCurrency(supabase, companyId);
  const currency = resolveWriteCurrency(extraction.currency, companyCurrency);
  const mismatch = currencyMismatchReason(currency, companyCurrency);
  if (mismatch) {
    return { ok: false, reason: "currency_mismatch", message: mismatch };
  }

  // ---- Resolve supplier (lookup now, create only once we know we write) ----
  let supplierId: string | null = null;
  let supplierName: string | null = null;
  const wantedSupplier =
    extraction.supplier_name && extraction.supplier_name.trim() !== ""
      ? extraction.supplier_name.trim()
      : null;
  if (wantedSupplier) {
    supplierName = wantedSupplier;
    const { data: existing } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .ilike("name", wantedSupplier)
      .limit(1);
    if (existing && existing.length > 0) {
      supplierId = (existing[0] as { id: string }).id;
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

  // ---- Plan the lines ----
  const planned: PlannedLine[] = [];
  const skipped: SkippedLine[] = [];
  for (const line of extraction.lines) {
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
    // Derive unit_cost if missing but quantity + line_total are present.
    const unitCostRead =
      line.unit_cost !== null && line.unit_cost >= 0
        ? line.unit_cost
        : line.quantity !== null &&
            line.quantity > 0 &&
            line.line_total !== null
          ? line.line_total / line.quantity
          : null;

    if (!strict) {
      planned.push({
        line,
        matchIngredientId: match?.ingredient_id ?? null,
        matched: !!match,
        // Schema requires positive quantity; coerce to 1 when missing so the
        // line can still be created and the user can fix it.
        quantity:
          line.quantity !== null && line.quantity > 0 ? line.quantity : 1,
        unit: line.unit ?? "unit",
        unitCost: unitCostRead,
        lineTotal: line.line_total !== null ? line.line_total : 0,
      });
      continue;
    }

    // Strict: only what was really read.
    const description = (line.description ?? "").trim();
    if (description === "") continue; // nothing to show a reviewer
    const hasQty = line.quantity !== null && line.quantity > 0;
    const hasPrice =
      line.line_total !== null ||
      (line.unit_cost !== null && line.unit_cost >= 0);
    if (!hasPrice) {
      skipped.push({ description, reason: "no_price" });
      continue;
    }
    if (!hasQty) {
      skipped.push({ description, reason: "no_quantity" });
      continue;
    }
    const quantity = line.quantity as number;
    const lineTotal =
      line.line_total !== null
        ? line.line_total
        : quantity * (line.unit_cost as number);
    // unit is NOT NULL in the table; never invent it. The catalog unit of the
    // matched ingredient is a real fact, anything else leaves the line out.
    const catalogUnit = match
      ? (ingredientCatalog.find((c) => c.id === match.ingredient_id)
          ?.default_unit ?? null)
      : null;
    const unit = line.unit ?? catalogUnit;
    if (!unit) {
      skipped.push({ description, reason: "no_unit" });
      continue;
    }
    planned.push({
      line,
      matchIngredientId: match?.ingredient_id ?? null,
      matched: !!match,
      quantity,
      unit,
      unitCost: unitCostRead,
      lineTotal,
    });
  }

  if (strict && planned.length === 0) {
    return {
      ok: false,
      reason: "no_usable_lines",
      message: "No line had a readable price and quantity.",
    };
  }

  // ---- Create the supplier if needed ----
  if (wantedSupplier && !supplierId) {
    const { data: created, error: createErr } = await supabase
      .from("suppliers")
      .insert({ company_id: companyId, name: wantedSupplier, status: "active" })
      .select("id")
      .single();
    if (createErr || !created) {
      return {
        ok: false,
        reason: "supplier_failed",
        message: "Could not create supplier",
        details: createErr?.message,
      };
    }
    supplierId = (created as { id: string }).id;
  }

  // ---- Insert invoice header ----
  let subtotal = extraction.subtotal;
  if (subtotal === null) {
    if (strict) {
      // Only a sum of lines that were all stored is a real subtotal.
      subtotal =
        planned.length === extraction.lines.length
          ? planned.reduce((acc, p) => acc + p.lineTotal, 0)
          : null;
    } else {
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
  }
  const taxAmount = extraction.tax_amount;
  const totalAmount =
    extraction.total_amount !== null
      ? extraction.total_amount
      : subtotal !== null
        ? subtotal + (taxAmount ?? 0)
        : null;

  const noteParts: string[] = [];
  if (input.extraNotes && input.extraNotes.trim() !== "") {
    noteParts.push(input.extraNotes.trim());
  }
  if (extraction.confidence_notes.length > 0) {
    noteParts.push(
      `AI extraction notes: ${extraction.confidence_notes.join(" · ")}`
    );
  }
  if (usedFallbackDate) {
    noteParts.push(input.fallbackDateNote ?? DEFAULT_FALLBACK_DATE_NOTE);
  }
  if (strict) {
    const unpriced = skipped
      .filter((s) => s.reason !== "no_unit")
      .map((s) => s.description);
    const noUnit = skipped
      .filter((s) => s.reason === "no_unit")
      .map((s) => s.description);
    if (unpriced.length > 0) {
      noteParts.push(
        `Líneas sin precio (leídas de la foto): ${unpriced.join(", ")}`
      );
    }
    if (noUnit.length > 0) {
      noteParts.push(
        `Líneas sin unidad legible (leídas de la foto): ${noUnit.join(", ")}`
      );
    }
  }

  const { data: inserted, error: invErr } = await supabase
    .from("supplier_invoices")
    .insert({
      company_id: companyId,
      supplier_id: supplierId,
      invoice_number: extraction.invoice_number,
      invoice_date: invoiceDate,
      due_date: extraction.due_date,
      currency,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: "needs_review",
      source_type: sourceType,
      original_file_name: originalFileName,
      created_by_user_id: userId,
      notes: noteParts.length > 0 ? noteParts.join("\n") : null,
    })
    .select(INVOICE_SELECT)
    .single();
  if (invErr || !inserted) {
    return {
      ok: false,
      reason: "invoice_failed",
      message: "Could not create invoice",
      details: invErr?.message,
    };
  }
  const invoiceId = (inserted as { id: string }).id;

  // ---- Line inserts ----
  let autoMatched = 0;
  let unmatched = 0;
  const lineInserts = planned.map((p) => {
    const matchStatus: InvoiceLineMatchStatus = p.matched
      ? "auto_matched"
      : "unmatched";
    if (p.matched) autoMatched++;
    else unmatched++;
    return {
      company_id: companyId,
      invoice_id: invoiceId,
      supplier_id: supplierId,
      ingredient_id: p.matchIngredientId,
      supplier_item_name: p.line.supplier_item_name,
      supplier_sku: p.line.supplier_sku,
      description: p.line.description,
      quantity: p.quantity,
      unit: p.unit,
      unit_cost: p.unitCost,
      line_total: p.lineTotal,
      tax_amount: p.line.tax_amount,
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
    console.error("[invoice-draft] line insert:", linesErr.message);
    return {
      ok: false,
      reason: "lines_failed",
      message: "Invoice header created but line insert failed.",
      details: linesErr.message,
      invoice: inserted as Record<string, unknown>,
    };
  }

  // ---- Audit events ----
  const extra = input.eventMetadata ?? {};
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
        ...extra,
      },
    },
    {
      company_id: companyId,
      invoice_id: invoiceId,
      event_type: "created",
      user_id: userId,
      metadata: { source: "ai_extraction", ...extra },
    },
  ]);

  return {
    ok: true,
    invoiceId,
    invoice: inserted as Record<string, unknown>,
    linesInserted: count ?? lineInserts.length,
    autoMatched,
    unmatched,
    linesSkipped: skipped,
    supplierId,
    supplierName,
    invoiceDate,
    usedFallbackDate,
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** True when an invoice event of this company already carries this report id. */
export async function invoiceExistsForKitchenReport(
  client: Client,
  companyId: string,
  kitchenReportId: string
): Promise<boolean> {
  const { data, error } = await (client as SupabaseClient)
    .from("invoice_events")
    .select("id")
    .eq("company_id", companyId)
    .eq("metadata->>kitchen_report_id", kitchenReportId)
    .limit(1);
  if (error) {
    console.error("[invoice-draft] duplicate check:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}
