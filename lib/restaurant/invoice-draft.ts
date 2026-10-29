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

import { runChat } from "@/lib/ai/call";
import {
  findExactIngredient,
  findSynonymIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_INSTRUCTION,
  deriveQuantityFromTotal,
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
  "No se leyó la fecha en la foto; usamos la fecha en que se mandó por Telegram.";

export const DEFAULT_VISION_TIMEOUT_MS = 40_000;

/** Telegram path: the person reads the notes, and they read Spanish. */
const NOTES_IN_SPANISH =
  "Write every free-text note (confidence_notes) in Spanish (neutral Latin American). Do not translate names, brands or values read from the invoice.";

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
  /** For the AI usage log only. */
  companyId?: string | null;
  /** Language of the model's free-text notes (default: as the invoice is written). */
  notesLanguage?: "es";
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

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
    const result = await runChat({
      feature: "invoice-extract",
      companyId: opts.companyId,
      signal: controller.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_VISION_TIMEOUT_MS,
      params: {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              opts.notesLanguage === "es"
                ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${NOTES_IN_SPANISH}`
                : EXTRACTION_SYSTEM_PROMPT,
          },
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
    });
    if (!result.ok) {
      if (timedOut || result.kind === "timeout") {
        console.error("[invoice-draft] openai call timed out");
        return {
          ok: false,
          reason: "timeout",
          message: "OpenAI call failed: request timed out",
        };
      }
      console.error("[invoice-draft] openai call failed:", result.kind);
      return {
        ok: false,
        reason: "upstream",
        message: `OpenAI call failed: ${result.message ?? result.kind}`,
      };
    }
    const completion = result.value;
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
  /**
   * Opt-in (Telegram price updates only): when no SKU / supplier-link match
   * exists, match the line's name to an ACTIVE ingredient of the company by
   * EXACT name or plural/synonym (never loose). Invoice photos and web
   * uploads never set it, so their matching is unchanged.
   */
  matchByIngredientName?: boolean;
}

const COUNT_WORDS = [
  "manojo",
  "atado",
  "unidad",
  "pieza",
  "docena",
  "bolsa",
  "caja",
] as const;
// Count words stored as a plain «unidad».
const COUNT_AS_UNIT = new Set<string>(["manojo", "atado", "unidad", "docena"]);

function foldWords(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** The count word in `raw` (singular), or null. */
function countWordOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const f = foldWords(raw);
  for (const w of COUNT_WORDS) {
    if (new RegExp(`(^|[^a-z])${w}(e?s)?([^a-z]|$)`).test(f)) return w;
  }
  return null;
}

function stripCountWord(description: string): string {
  const out = description.replace(/^\s*docenas?\s+(de\s+)?/i, "").trim();
  return out === "" ? description : out;
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

const money = (n: number) => n.toFixed(2);
/** Up to 3 decimals, trailing zeros trimmed (15, 2.5, 0.125). */
const trimNum = (n: number) => String(Number(n.toFixed(3)));

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
        message: "Falta la fecha de la factura. Agrégala antes de guardar.",
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
  let catalogQuery = supabase
    .from("ingredients")
    .select("id, name, default_unit")
    .eq("company_id", companyId);
  // A name match must never land on an archived (merged / hidden) ingredient.
  if (input.matchByIngredientName) {
    catalogQuery = catalogQuery.is("archived_at", null);
  }
  const { data: catalogRows } = await catalogQuery;
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
  const derivedQtyNotes: string[] = [];
  for (const line of extraction.lines) {
    let match = matchIngredientForLine(
      {
        ingredient_name: null, // OpenAI does not return ingredient_name; matching by item-name / sku only
        supplier_item_name: line.supplier_item_name,
        supplier_sku: line.supplier_sku,
        supplier_id: supplierId,
      },
      ingredientCatalog,
      supplierLinks
    );
    if (!match && input.matchByIngredientName) {
      // Exact name, then plural / synonym (the same rules as the stock-report
      // and recipe-draft paths). Never one-shared-word or loose matches.
      const said = line.supplier_item_name ?? line.description ?? "";
      const hit =
        findExactIngredient(said, ingredientCatalog) ??
        findSynonymIngredient(said, ingredientCatalog);
      if (hit) match = { ingredient_id: hit.id, via: "ingredient_name" };
    }
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
    // A quantity the model left blank but that follows exactly from the read
    // price and total (also when enrichExtraction already derived it).
    const readQty = line.quantity !== null && line.quantity > 0;
    const calcQty = readQty
      ? null
      : deriveQuantityFromTotal(line.unit_cost, line.line_total);
    const enrichedDerived =
      readQty &&
      (line as { derived_quantity?: boolean }).derived_quantity === true &&
      line.unit_cost !== null &&
      line.line_total !== null;
    const hasQty = readQty || calcQty !== null;
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
    const quantity = readQty ? (line.quantity as number) : (calcQty as number);
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
    let unit = line.unit ?? catalogUnit;
    let plannedQty = quantity;
    // Count words are units (manojo, docena, bolsa...). A docena is 12 units.
    const countWord = line.unit
      ? countWordOf(line.unit)
      : countWordOf(description);
    let plannedUnitCost = unitCostRead;
    if (countWord === "docena" && readQty) {
      plannedQty = quantity * 12;
      unit = "unidad";
      plannedUnitCost = unitCostRead !== null ? unitCostRead / 12 : null;
      derivedQtyNotes.push(
        `Docena convertida a 12 unidades: ${stripCountWord(description)}`
      );
    } else if (line.unit && COUNT_AS_UNIT.has(countWord ?? "")) {
      // A written count unit (manojo, atado) is a plain unit.
      unit = "unidad";
    } else if (!unit && readQty) {
      // No unit anywhere but a quantity that was really read: a count word, else a bare count.
      unit = countWord && !COUNT_AS_UNIT.has(countWord) ? countWord : "unidad";
    }
    if (!unit) {
      skipped.push({ description, reason: "no_unit" });
      continue;
    }
    planned.push({
      line,
      matchIngredientId: match?.ingredient_id ?? null,
      matched: !!match,
      quantity: plannedQty,
      unit,
      unitCost: plannedUnitCost,
      lineTotal,
    });
    if ((calcQty !== null || enrichedDerived) && line.unit_cost !== null) {
      derivedQtyNotes.push(
        `Cantidad calculada de total ÷ precio: ${description} = ${money(
          line.line_total as number
        )} ÷ ${money(line.unit_cost)} = ${trimNum(quantity)}`
      );
    }
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
      `Notas de la lectura: ${extraction.confidence_notes.join(" · ")}`
    );
  }
  if (usedFallbackDate) {
    noteParts.push(input.fallbackDateNote ?? DEFAULT_FALLBACK_DATE_NOTE);
  }
  if (strict) {
    const names = (reason: SkippedLine["reason"]) =>
      skipped.filter((s) => s.reason === reason).map((s) => s.description);
    const unpriced = names("no_price");
    const noQty = names("no_quantity");
    const noUnit = names("no_unit");
    if (derivedQtyNotes.length > 0) {
      noteParts.push(derivedQtyNotes.join("\n"));
    }
    if (unpriced.length > 0) {
      noteParts.push(
        `Líneas sin precio (leídas de la foto): ${unpriced.join(", ")}`
      );
    }
    if (noQty.length > 0) {
      noteParts.push(
        `Líneas sin cantidad (leídas de la foto): ${noQty.join(", ")}`
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
