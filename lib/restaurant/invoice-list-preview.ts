// lib/restaurant/invoice-list-preview.ts
//
// One pure helper for the two Compras list builders (loadInvoicesTabData and
// GET /api/restaurant/invoices): line counts («1 de 1 asignadas») and the
// first lines of each invoice («Productos» column), so they cannot drift.

import {
  parseMissing,
  type MissingField,
} from "@/lib/restaurant/invoice-missing";

export interface InvoiceLineCounts {
  total: number;
  matched: number;
  approved: number;
  unmatched: number;
  pending: number;
}

export interface InvoiceLinePreview {
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  matched: boolean;
  /** Fields the kitchen could not read: shown as «Falta» (invoice-missing.ts). */
  missing?: MissingField[];
}

/**
 * What the Total column shows for an invoice whose lines the kitchen filled in.
 * `total` = the sum of qty × price when EVERY line has one, else null.
 */
export interface InvoiceAmounts {
  total: number | null;
  /** At least one line has a price (a unit cost or a line total). */
  priced: boolean;
}

/** Columns the list builders must select from supplier_invoice_lines. */
export const INVOICE_LINE_PREVIEW_SELECT =
  "invoice_id, ingredient_id, supplier_item_name, description, quantity, unit, unit_cost, line_total, notes, created_at, id, match_status, review_status";

export interface InvoiceLinePreviewRow {
  id?: string | null;
  invoice_id: string;
  ingredient_id?: string | null;
  supplier_item_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_cost?: number | string | null;
  line_total?: number | string | null;
  notes?: string | null;
  created_at?: string | null;
  match_status: string;
  review_status: string;
}

export const PREVIEW_LIMIT = 2;

export const emptyLineCounts = (): InvoiceLineCounts => ({
  total: 0,
  matched: 0,
  approved: 0,
  unmatched: 0,
  pending: 0,
});

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Stable order: created_at, then id. */
function byCreatedThenId(
  a: InvoiceLinePreviewRow,
  b: InvoiceLinePreviewRow
): number {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  const ia = a.id ?? "";
  const ib = b.id ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Counts and preview per invoice id. Only ids in `invoiceIds` get an entry
 * (every one of them does, empty if it has no lines). The matched ingredient's
 * name wins over the line text; then supplier_item_name; then description.
 */
export function buildInvoiceLineSummaries(
  invoiceIds: readonly string[],
  lines: readonly InvoiceLinePreviewRow[],
  ingredientNameById: ReadonlyMap<string, string>
): Map<
  string,
  {
    counts: InvoiceLineCounts;
    preview: InvoiceLinePreview[];
    amounts: InvoiceAmounts;
  }
> {
  const grouped = new Map<string, InvoiceLinePreviewRow[]>();
  const out = new Map<
    string,
    {
      counts: InvoiceLineCounts;
      preview: InvoiceLinePreview[];
      amounts: InvoiceAmounts;
    }
  >();
  for (const id of invoiceIds) {
    out.set(id, {
      counts: emptyLineCounts(),
      preview: [],
      amounts: { total: null, priced: false },
    });
    grouped.set(id, []);
  }
  for (const l of lines) {
    const entry = out.get(l.invoice_id);
    if (!entry) continue;
    const c = entry.counts;
    c.total++;
    if (l.match_status === "matched" || l.match_status === "auto_matched") {
      c.matched++;
    }
    if (l.match_status === "unmatched") c.unmatched++;
    if (l.review_status === "approved") c.approved++;
    if (l.review_status === "pending") c.pending++;
    grouped.get(l.invoice_id)!.push(l);
  }
  for (const [id, rows] of grouped) {
    const entry = out.get(id)!;
    // Total = qty × price of every line, only when none is incomplete.
    let sum = 0;
    let complete = rows.length > 0;
    let priced = false;
    for (const l of rows) {
      const missing = parseMissing(l.notes);
      const total = num(l.line_total);
      const cost = num(l.unit_cost);
      if ((total !== null && total > 0) || (cost !== null && cost > 0)) {
        priced = true;
      }
      if (missing.includes("quantity") || total === null || total <= 0) {
        complete = false;
      } else sum += total;
    }
    entry.amounts = { total: complete ? sum : null, priced };
    entry.preview = [...rows]
      .sort(byCreatedThenId)
      .slice(0, PREVIEW_LIMIT)
      .map((l) => {
        const ingName = l.ingredient_id
          ? clean(ingredientNameById.get(l.ingredient_id))
          : "";
        const name =
          ingName ||
          clean(l.supplier_item_name) ||
          clean(l.description) ||
          "Producto";
        const unit = clean(l.unit);
        return {
          name,
          quantity: num(l.quantity),
          unit: unit || null,
          unit_cost: num(l.unit_cost),
          matched: !!ingName,
          missing: parseMissing(l.notes),
        };
      });
  }
  return out;
}

/** «1», «2.5»: no trailing zeros. */
export function formatPreviewQuantity(n: number): string {
  return String(Number(n.toFixed(3)));
}
