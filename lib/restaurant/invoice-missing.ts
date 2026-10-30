// lib/restaurant/invoice-missing.ts
//
// Lines the kitchen (Telegram / Cocina app) could only half read: «tomates»
// with no quantity, unit or price. They are kept (never dropped) and shown in
// Compras with «Sin precio» / «Falta» for the manager to complete. The table
// requires a positive quantity and a unit, so a placeholder is stored and the
// line's `notes` says which field is really missing: «[falta:cantidad,unidad]».
// No migration: `notes` already exists on supplier_invoice_lines.

export type MissingField = "quantity" | "unit";

const TOKEN: Record<MissingField, string> = {
  quantity: "cantidad",
  unit: "unidad",
};

export function encodeMissing(fields: MissingField[]): string | null {
  const parts = (["quantity", "unit"] as const)
    .filter((f) => fields.includes(f))
    .map((f) => TOKEN[f]);
  return parts.length > 0 ? `[falta:${parts.join(",")}]` : null;
}

export function parseMissing(notes: unknown): MissingField[] {
  if (typeof notes !== "string") return [];
  const m = /\[falta:([a-z,]+)\]/.exec(notes);
  if (!m) return [];
  const out: MissingField[] = [];
  for (const part of m[1].split(",")) {
    if (part === TOKEN.quantity) out.push("quantity");
    if (part === TOKEN.unit) out.push("unit");
  }
  return out;
}

/** The note after the manager filled `filled`: the marker keeps only what is still missing. */
export function clearMissing(
  notes: string | null | undefined,
  filled: MissingField[]
): string | null {
  const text = typeof notes === "string" ? notes : "";
  const still = parseMissing(text).filter((f) => !filled.includes(f));
  const rest = text.replace(/\s*\[falta:[a-z,]+\]\s*/, " ").trim();
  const marker = encodeMissing(still);
  const out = [rest, marker].filter(Boolean).join(" ");
  return out === "" ? null : out;
}

/**
 * A line the kitchen left incomplete must not be approved or posted: it has no
 * price (no unit cost and a total of 0) or still carries a «[falta:…]» marker.
 * Placeholders are never real numbers.
 */
export function lineIsIncomplete(line: {
  unit_cost?: unknown;
  line_total?: unknown;
  notes?: unknown;
}): boolean {
  if (parseMissing(line.notes).length > 0) return true;
  const cost = Number(line.unit_cost);
  const hasCost =
    line.unit_cost !== null &&
    line.unit_cost !== undefined &&
    Number.isFinite(cost);
  const total = Number(line.line_total);
  return !hasCost && !(Number.isFinite(total) && total > 0);
}

/** The line note without the «[falta:…]» marker (for copies into cost entries). */
export function stripMissing(notes: string | null | undefined): string | null {
  if (typeof notes !== "string") return null;
  const out = notes.replace(/\s*\[falta:[a-z,]+\]\s*/g, " ").trim();
  return out === "" ? null : out;
}
