// lib/restaurant/invoice-extraction.ts
//
// Strict JSON schema + system prompt for the AI-assisted supplier-invoice
// extraction route. Kept separate from the API handler so the prompt is
// easy to tune in isolation and reusable from tests.
//
// Two layers of types:
//   * ExtractedInvoice / ExtractedInvoiceLine  — RAW model output
//   * EnrichedInvoice  / EnrichedInvoiceLine   — server-augmented version
//     with per-line flags (missing_*, derived_*, low_confidence) computed
//     from the model output. The UI consumes the enriched shape.

// ---------------------------------------------------------------------------
// Output shape — RAW model output
// ---------------------------------------------------------------------------

export type LineConfidence = "high" | "medium" | "low";

export interface ExtractedInvoiceLine {
  description: string;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  line_total: number | null;
  tax_amount: number | null;
  /** Per-line confidence reported by the model. Optional for back-compat
   *  with older clients; the prompt asks for it explicitly. */
  confidence?: LineConfidence | null;
  /** Optional per-line note (≤ 1 short sentence). Numbers must not live
   *  here — they belong in the numeric fields above. */
  confidence_notes?: string | null;
}

export interface ExtractedInvoice {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  lines: ExtractedInvoiceLine[];
  /** Invoice-level uncertainty notes (≤ 6 items). */
  confidence_notes: string[];
}

// ---------------------------------------------------------------------------
// Enriched shape — server adds per-line flags after validation
// ---------------------------------------------------------------------------

export interface EnrichedInvoiceLine extends ExtractedInvoiceLine {
  /** Description is empty / missing. */
  missing_description: boolean;
  /** Quantity is null or ≤ 0. */
  missing_quantity: boolean;
  /** Unit is null or empty. */
  missing_unit: boolean;
  /** line_total is null. */
  missing_line_total: boolean;
  /** Server filled unit_cost from line_total / quantity. */
  derived_unit_cost: boolean;
  /** Server filled line_total from quantity * unit_cost. */
  derived_line_total: boolean;
  /** Either confidence === 'low' or the line lacks values required to post. */
  low_confidence: boolean;
}

export interface EnrichedInvoice extends Omit<ExtractedInvoice, "lines"> {
  lines: EnrichedInvoiceLine[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isNullableNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function isOptionalConfidence(
  v: unknown
): v is LineConfidence | null | undefined {
  return (
    v === undefined ||
    v === null ||
    v === "high" ||
    v === "medium" ||
    v === "low"
  );
}
function isOptionalNullableString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

function isLine(v: unknown): v is ExtractedInvoiceLine {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.description === "string" &&
    isNullableString(o.supplier_item_name) &&
    isNullableString(o.supplier_sku) &&
    isNullableNumber(o.quantity) &&
    isNullableString(o.unit) &&
    isNullableNumber(o.unit_cost) &&
    isNullableNumber(o.line_total) &&
    isNullableNumber(o.tax_amount) &&
    isOptionalConfidence(o.confidence) &&
    isOptionalNullableString(o.confidence_notes)
  );
}

export function isExtractedInvoice(v: unknown): v is ExtractedInvoice {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    isNullableString(o.supplier_name) &&
    isNullableString(o.invoice_number) &&
    isNullableString(o.invoice_date) &&
    isNullableString(o.due_date) &&
    isNullableString(o.currency) &&
    isNullableNumber(o.subtotal) &&
    isNullableNumber(o.tax_amount) &&
    isNullableNumber(o.total_amount) &&
    Array.isArray(o.lines) &&
    o.lines.every(isLine) &&
    Array.isArray(o.confidence_notes) &&
    o.confidence_notes.every((x) => typeof x === "string")
  );
}

// ---------------------------------------------------------------------------
// Normalize (string trims, currency upper-case, defensive caps)
// ---------------------------------------------------------------------------

const trimOrNull = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

export function normalizeExtraction(raw: ExtractedInvoice): ExtractedInvoice {
  const currency = trimOrNull(raw.currency);
  return {
    supplier_name: trimOrNull(raw.supplier_name),
    invoice_number: trimOrNull(raw.invoice_number),
    invoice_date: trimOrNull(raw.invoice_date),
    due_date: trimOrNull(raw.due_date),
    currency:
      currency && /^[A-Za-z]{3}$/.test(currency)
        ? currency.toUpperCase()
        : currency,
    subtotal: raw.subtotal,
    tax_amount: raw.tax_amount,
    total_amount: raw.total_amount,
    lines: raw.lines.slice(0, 200).map((l) => ({
      description: l.description.trim(),
      supplier_item_name: trimOrNull(l.supplier_item_name),
      supplier_sku: trimOrNull(l.supplier_sku),
      quantity: l.quantity,
      unit: trimOrNull(l.unit),
      unit_cost: l.unit_cost,
      line_total: l.line_total,
      tax_amount: l.tax_amount,
      confidence:
        l.confidence === "high" ||
        l.confidence === "medium" ||
        l.confidence === "low"
          ? l.confidence
          : null,
      confidence_notes: trimOrNull(l.confidence_notes ?? null),
    })),
    confidence_notes: raw.confidence_notes.slice(0, 10).map((s) => s.trim()),
  };
}

// ---------------------------------------------------------------------------
// Enrichment — server-side derivations and flags
// ---------------------------------------------------------------------------

/**
 * Augments a normalized extraction with per-line flags and (cheap)
 * unit_cost / line_total derivations when one side is known. Never mutates
 * the input.
 *
 * Rules:
 *   * derived_unit_cost:   set when unit_cost was null AND quantity > 0
 *                          AND line_total != null. Fills unit_cost.
 *   * derived_line_total:  set when line_total was null AND quantity != null
 *                          AND unit_cost != null. Fills line_total.
 *   * missing_*:           reflect the FINAL value after derivation.
 *   * low_confidence:      true if model returned confidence === 'low' OR
 *                          any required field (description/qty/unit/total)
 *                          is still missing.
 */
export function enrichExtraction(
  extraction: ExtractedInvoice
): EnrichedInvoice {
  const lines: EnrichedInvoiceLine[] = extraction.lines.map((line) => {
    let unitCost = line.unit_cost;
    let lineTotal = line.line_total;
    let derivedUnitCost = false;
    let derivedLineTotal = false;

    const qty = line.quantity;

    if (
      unitCost === null &&
      qty !== null &&
      qty > 0 &&
      lineTotal !== null &&
      Number.isFinite(lineTotal)
    ) {
      unitCost = lineTotal / qty;
      derivedUnitCost = true;
    } else if (
      lineTotal === null &&
      qty !== null &&
      Number.isFinite(qty) &&
      unitCost !== null &&
      Number.isFinite(unitCost)
    ) {
      lineTotal = qty * unitCost;
      derivedLineTotal = true;
    }

    const missingDescription =
      !line.description || line.description.trim() === "";
    const missingQuantity = qty === null || !(qty > 0);
    const missingUnit = !line.unit;
    const missingLineTotal = lineTotal === null;
    const lowConfidence =
      line.confidence === "low" ||
      missingDescription ||
      missingQuantity ||
      missingUnit ||
      missingLineTotal;

    return {
      ...line,
      unit_cost: unitCost,
      line_total: lineTotal,
      missing_description: missingDescription,
      missing_quantity: missingQuantity,
      missing_unit: missingUnit,
      missing_line_total: missingLineTotal,
      derived_unit_cost: derivedUnitCost,
      derived_line_total: derivedLineTotal,
      low_confidence: lowConfidence,
    };
  });

  return { ...extraction, lines };
}

// ---------------------------------------------------------------------------
// System prompt
//
// Tuned for restaurant supplier invoices in Spanish + English. The most
// important rules: (a) preserve SKU/description exactly, (b) parse the
// table even when columns are wide, (c) numeric values must be JSON
// numbers (no currency symbols, no thousand separators), (d) confidence
// is a per-line signal, not a global one.
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT = [
  "You are Milton, a careful invoice-extraction assistant for a restaurant.",
  "You are given a supplier invoice as an image. Read it and produce ONE JSON",
  "object with the structure below.",
  "",
  "How to read the invoice:",
  "- Find the line-item table. Read its column headers (commonly: SKU /",
  "  Código / Clave, Description / Descripción / Concepto, Quantity /",
  "  Cantidad / Cant., Unit / U.M., Unit price / Precio Unitario / P.U.,",
  "  Line total / Importe / Subtotal).",
  "- For each product row, extract supplier_sku, description, quantity,",
  "  unit, unit_cost, line_total, and tax_amount if present.",
  "- Preserve the SKU exactly as printed (e.g. 'DN-BRIS-10KG'). Do not",
  "  re-format SKUs.",
  "- Preserve original item description text exactly (do not translate,",
  "  do not rephrase).",
  "- Skip blank rows, total/subtotal/tax summary rows, terms text,",
  "  thank-you lines, and shipping summaries.",
  "",
  "Numbers and dates:",
  "- All numeric fields must be JSON numbers WITHOUT currency symbols,",
  "  WITHOUT thousand separators, WITHOUT units, and WITHOUT trailing",
  "  text. Examples:",
  "    '$3,850.00'    → 3850",
  "    '$1.220,64'    → 1220.64        (Latin-American decimal comma)",
  "    'MXN 92.50'    → 92.5",
  "    '2 kg'         (in a quantity cell)  → 2     (and unit='kg')",
  "- Keep the sign on credits/discounts (negative line totals).",
  "- Normalize dates to YYYY-MM-DD. If ambiguous (e.g. 04/05/2025), use",
  "  null rather than guessing.",
  "- Currency: 3-letter ISO code (USD, MXN, EUR, GBP, CAD…) when",
  "  recognizable, otherwise null.",
  "",
  "Per-line confidence:",
  "- confidence = 'high'   when all of description, quantity, unit, and",
  "  line_total are clearly visible and unambiguous.",
  "- confidence = 'medium' when most fields are clear but one number or the",
  "  unit is faint, partially cropped, or hard to disambiguate.",
  "- confidence = 'low'    when the row is barely legible, partially",
  "  occluded, or a value had to be guessed. Set the affected fields to",
  "  null and flag them in confidence_notes.",
  "",
  "Strict rules:",
  "1. Use null for ANY value that is not clearly visible. Do not invent.",
  "2. Do not invent line items.",
  "3. Output VALID JSON only — no markdown, no commentary, no code fences.",
  "",
  "JSON schema:",
  "{",
  '  "supplier_name": string | null,',
  '  "invoice_number": string | null,',
  '  "invoice_date":   string | null,   // YYYY-MM-DD',
  '  "due_date":       string | null,   // YYYY-MM-DD',
  '  "currency":       string | null,   // ISO-4217 code',
  '  "subtotal":       number | null,',
  '  "tax_amount":     number | null,',
  '  "total_amount":   number | null,',
  '  "lines": [',
  "    {",
  '      "description":        string,',
  '      "supplier_item_name": string | null,',
  '      "supplier_sku":       string | null,',
  '      "quantity":           number | null,',
  '      "unit":               string | null,',
  '      "unit_cost":          number | null,',
  '      "line_total":         number | null,',
  '      "tax_amount":         number | null,',
  '      "confidence":         "high" | "medium" | "low",',
  '      "confidence_notes":   string | null',
  "    }",
  "  ],",
  '  "confidence_notes": string[]      // up to 6 short notes',
  "}",
].join("\n");

export const EXTRACTION_USER_INSTRUCTION =
  "Extract the supplier invoice fields from this image into the JSON object specified in the system prompt. Read the line-item table carefully. Return JSON only.";

// ---------------------------------------------------------------------------
// Backwards-compat heuristic — kept for any caller that wants a quick
// "this line still needs a human" check without the full enriched flags.
// ---------------------------------------------------------------------------

export function lineNeedsReview(line: ExtractedInvoiceLine): boolean {
  if (!line.description || line.description.trim() === "") return true;
  if (line.quantity === null || line.quantity <= 0) return true;
  if (!line.unit) return true;
  if (line.line_total === null) return true;
  return false;
}
