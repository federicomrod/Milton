import type { SuggestionEvidenceView } from "./evidence";
import { formatMoneyEs } from "./format";

export type ProductKindLabel =
  | "Plato"
  | "Combo"
  | "Bebida"
  | "Modificador"
  | "Cargo";

export type DisplayStateLabel =
  | "Confirmado"
  | "Sugerido"
  | "Ambiguo"
  | "Combo"
  | "Sin receta"
  | "No requiere"
  | "Reventa"
  | "Sin vincular";

export type ChipTone = "ok" | "sug" | "warn" | "bad" | "grey" | "pur";

const DRINK_NAME =
  /\b(coca[- ]?cola|pepsi|sprite|fanta|cerveza|bebida|refresco|soda|agua|jugo|limonada|horchata|jamaica|caf[eé]|t[eé]|licor|vino|whisky|ron|vodka|gaseosa|h2o)\b/i;
const DRINK_CATEGORY = /bebida|drink|bar|refresco|licor|cerveza/i;
const CARGO_NAME =
  /\b(propina|tip|cargo|servicio|delivery|env[ií]o|cargo por servicio)\b/i;

export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stemWords(value: string): string {
  return foldName(value)
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word
    )
    .join(" ");
}

export function namesAlmostEqual(left: string, right: string): boolean {
  const a = foldName(left);
  const b = foldName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = stemWords(left);
  const sb = stemWords(right);
  if (sa === sb) return true;
  if (a.endsWith("s") && a.slice(0, -1) === b) return true;
  if (b.endsWith("s") && b.slice(0, -1) === a) return true;
  return sa.includes(sb) || sb.includes(sa);
}

export function looksLikeDrink(input: {
  name: string;
  category?: string | null;
}): boolean {
  if (input.category && DRINK_CATEGORY.test(input.category)) return true;
  return DRINK_NAME.test(input.name);
}

export function looksLikeCargo(name: string): boolean {
  return CARGO_NAME.test(name);
}

export function productKindLabel(input: {
  name: string;
  is_combo: boolean;
  classification: string;
  category?: string | null;
}): ProductKindLabel {
  if (input.is_combo) return "Combo";
  if (
    input.classification === "modificador_con_costo" ||
    input.classification === "modificador_sin_costo"
  ) {
    return "Modificador";
  }
  if (input.classification === "excluido") return "Cargo";
  if (input.classification === "reventa") return "Bebida";
  if (looksLikeCargo(input.name)) return "Cargo";
  if (looksLikeDrink({ name: input.name, category: input.category })) {
    return "Bebida";
  }
  return "Plato";
}

export function displayStateForProduct(input: {
  confirmed: boolean;
  is_combo: boolean;
  classification: string;
  kind_label: ProductKindLabel;
  ambiguous: boolean;
  suggested: boolean;
  bound: boolean;
  recipe_name: string | null;
}): { label: DisplayStateLabel; tone: ChipTone } {
  if (input.is_combo) return { label: "Combo", tone: "pur" };
  if (
    input.classification === "excluido" ||
    input.classification === "modificador_sin_costo"
  ) {
    return { label: "No requiere", tone: "grey" };
  }
  if (input.confirmed) return { label: "Confirmado", tone: "ok" };
  if (input.classification === "reventa") {
    return { label: "Reventa", tone: "sug" };
  }
  if (input.ambiguous) return { label: "Ambiguo", tone: "bad" };
  if (input.suggested && input.bound) return { label: "Sugerido", tone: "sug" };
  if (!input.recipe_name || !input.bound)
    return { label: "Sin receta", tone: "grey" };
  if (input.suggested) return { label: "Sugerido", tone: "sug" };
  return { label: "Sin vincular", tone: "grey" };
}

export interface EvidenceCheckItem {
  ok: boolean;
  warn: boolean;
  label: string;
}

export function evidenceChecklist(input: {
  odoo_name: string;
  block_name: string | null;
  evidence: SuggestionEvidenceView;
  pos_price: number | null;
  currency?: string;
}): EvidenceCheckItem[] {
  const items: EvidenceCheckItem[] = [];
  const block = input.block_name ?? input.evidence.block_name;
  if (block) {
    const same = namesAlmostEqual(input.odoo_name, block);
    items.push({
      ok: same,
      warn: !same,
      label: same
        ? "Nombre casi igual (singular/plural)"
        : `Nombre distinto a «${block}»`,
    });
  }
  if (input.pos_price != null && input.evidence.evidence_text) {
    const text = input.evidence.evidence_text;
    const mentionsPrice = /precio|pos|excel/i.test(text);
    if (mentionsPrice) {
      items.push({
        ok: true,
        warn: false,
        label: `Precio de venta del Excel = POS (${formatMoneyEs(input.pos_price, input.currency)})`,
      });
    }
  } else if (input.evidence.excel_match === "match") {
    items.push({
      ok: true,
      warn: false,
      label: "Precio / costo del Excel cuadra",
    });
  }
  for (const reason of input.evidence.reasons.slice(0, 3)) {
    if (!reason.trim()) continue;
    if (items.some((item) => item.label === reason)) continue;
    items.push({ ok: false, warn: true, label: reason });
  }
  if (items.length === 0 && input.evidence.evidence_text) {
    items.push({
      ok: Boolean(input.evidence.tab && input.evidence.block_name),
      warn: true,
      label: input.evidence.evidence_text,
    });
  }
  if (items.length === 0) {
    items.push({
      ok: false,
      warn: true,
      label: "Ninguna otra receta lo vende",
    });
  }
  return items.slice(0, 4);
}

export function formatUnitsLabel(units: number): string {
  const rounded = Math.round(units);
  return `${new Intl.NumberFormat("es-MX").format(rounded)} uds`;
}

export function odooSyncLabel(
  syncedAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!syncedAt) return null;
  const when = new Date(syncedAt);
  if (Number.isNaN(when.getTime())) return null;
  const minutes = Math.floor(
    Math.max(0, now.getTime() - when.getTime()) / 60_000
  );
  if (minutes < 1) return "Odoo sincronizado ahora mismo";
  if (minutes < 60) return `Odoo sincronizado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Odoo sincronizado hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Odoo sincronizado hace ${days} d`;
  return `Odoo sincronizado el ${when.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export function posPriceFromSales(
  netSales: number,
  unitsSold: number
): number | null {
  if (!(unitsSold > 0) || !(netSales > 0)) return null;
  return Math.round((netSales / unitsSold) * 100) / 100;
}
