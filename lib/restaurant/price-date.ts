export const PRICE_DATE_SOURCES = [
  "invoice",
  "dated_price_list",
  "upload",
  "confirmation",
  "manual",
] as const;

export type PriceDateSource = (typeof PRICE_DATE_SOURCES)[number];

export function isPriceDateSource(value: unknown): value is PriceDateSource {
  return (
    value === "invoice" ||
    value === "dated_price_list" ||
    value === "upload" ||
    value === "confirmation" ||
    value === "manual"
  );
}

/**
 * Pick the effective date and which source we used.
 * Known record dates win. A dated price list uses its own date.
 * Only fall back to the upload date when nothing else is known.
 */
export function resolveIngredientPriceDate(input: {
  recordDate?: string | null;
  priceListDate?: string | null;
  uploadDate: string;
  kind: "invoice" | "price_list" | "workbook" | "confirmation" | "manual";
}): { effective_date: string; date_source: PriceDateSource } {
  const record = trimDate(input.recordDate);
  const list = trimDate(input.priceListDate);
  const upload = trimDate(input.uploadDate) ?? input.uploadDate;

  if (input.kind === "invoice") {
    if (record) return { effective_date: record, date_source: "invoice" };
    return { effective_date: upload, date_source: "upload" };
  }
  if (input.kind === "manual") {
    return { effective_date: record ?? upload, date_source: "manual" };
  }
  if (input.kind === "confirmation") {
    return { effective_date: record ?? upload, date_source: "confirmation" };
  }
  if (input.kind === "price_list") {
    if (record) {
      return { effective_date: record, date_source: "dated_price_list" };
    }
    if (list) {
      return { effective_date: list, date_source: "dated_price_list" };
    }
    return { effective_date: upload, date_source: "upload" };
  }
  if (record) {
    return { effective_date: record, date_source: "upload" };
  }
  return { effective_date: upload, date_source: "upload" };
}

function trimDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const slice = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : null;
}
