import type { SuggestionEvidenceView } from "./evidence";
import { fmt, getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { formatMoneyEs, formatPctLabel } from "./format";

const DEFAULT_LANG = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;

export const CONFIRMED_HOW_OPTIONS = [
  { value: "en_pantalla", label: "En esta pantalla" },
  { value: "en_persona", label: "En persona" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "correo", label: "Correo" },
  { value: "llamada", label: "Llamada" },
] as const;

export type ConfirmedHow = (typeof CONFIRMED_HOW_OPTIONS)[number]["value"];

const CONFIRMED_HOW_KEYS = {
  en_pantalla: "onScreen",
  en_persona: "inPerson",
  whatsapp: "whatsapp",
  correo: "email",
  llamada: "call",
} as const;

/** The options with their labels in the person's language. */
export function confirmedHowOptions(
  lang: PreferredLanguage = DEFAULT_LANG
): Array<{ value: ConfirmedHow; label: string }> {
  const labels = getDictionary(lang).menu.workspace.copy.confirmedHow;
  return CONFIRMED_HOW_OPTIONS.map((option) => ({
    value: option.value,
    label: labels[CONFIRMED_HOW_KEYS[option.value]],
  }));
}

export function isConfirmedHow(value: unknown): value is ConfirmedHow {
  return (
    typeof value === "string" &&
    CONFIRMED_HOW_OPTIONS.some((option) => option.value === value)
  );
}

export type TodoKind =
  | "por_revisar"
  | "sugerido"
  | "ambiguo"
  | "sin_receta"
  | "falta_precio"
  | "combo"
  | "reventa"
  | "sin_vincular";

export const TODO_KIND_LABELS: Record<TodoKind, string> = {
  por_revisar: "Por revisar",
  sugerido: "Sugerido",
  ambiguo: "Ambiguo",
  sin_receta: "Sin receta",
  falta_precio: "Falta precio",
  combo: "Combo",
  reventa: "Reventa",
  sin_vincular: "Sin vincular",
};

export const TODO_KIND_ACTIONS: Record<TodoKind, string> = {
  por_revisar: "Revisar",
  sugerido: "Confirmar",
  ambiguo: "Elegir",
  sin_receta: "Crear receta",
  falta_precio: "Agregar precio",
  combo: "Ver partes",
  reventa: "Elegir qué compras",
  sin_vincular: "Vincular",
};

const TODO_KEYS = {
  por_revisar: "porRevisar",
  sugerido: "sugerido",
  ambiguo: "ambiguo",
  sin_receta: "sinReceta",
  falta_precio: "faltaPrecio",
  combo: "combo",
  reventa: "reventa",
  sin_vincular: "sinVincular",
} as const;

export function todoKindLabel(
  kind: TodoKind,
  lang: PreferredLanguage = DEFAULT_LANG
): string {
  return getDictionary(lang).menu.workspace.copy.todoKinds[TODO_KEYS[kind]];
}

export function todoKindAction(
  kind: TodoKind,
  lang: PreferredLanguage = DEFAULT_LANG
): string {
  return getDictionary(lang).menu.workspace.copy.todoActions[TODO_KEYS[kind]];
}

export function productReason(input: {
  kind: TodoKind;
  evidence: SuggestionEvidenceView;
  odoo_name: string;
  is_combo: boolean;
  has_components: boolean;
  /** Combo parts marked excluido. */
  excluded_parts?: readonly string[];
  currency?: string;
  lang?: PreferredLanguage;
}): string {
  const lang = input.lang ?? DEFAULT_LANG;
  const r = getDictionary(lang).menu.workspace.copy.reason;
  const first = input.evidence.reasons.find((reason) => reason.trim());
  if (input.kind === "falta_precio") {
    const line = input.evidence.lines.find((row) => row.pending);
    return (
      first ??
      (line
        ? fmt(r.priceMissingFor, { name: line.raw_name })
        : r.priceMissingGeneric)
    );
  }
  if (
    input.kind === "por_revisar" &&
    input.evidence.excel_match === "mismatch"
  ) {
    const milton =
      input.evidence.milton_cost != null
        ? formatMoneyEs(
            input.evidence.milton_cost,
            input.currency,
            undefined,
            lang
          )
        : r.noCost;
    const excel =
      input.evidence.excel_total != null
        ? formatMoneyEs(
            input.evidence.excel_total,
            input.currency,
            undefined,
            lang
          )
        : r.noData;
    const pct =
      input.evidence.variance_pct != null
        ? formatPctLabel(Math.abs(input.evidence.variance_pct))
        : null;
    const sentence = pct
      ? fmt(r.mismatchLower, { milton, pct, excel })
      : fmt(r.mismatchGeneric, { milton, excel });
    if (first && !/excel|costo de milton/i.test(first)) {
      return `${sentence} ${first}`;
    }
    return sentence;
  }
  if (input.kind === "sugerido") {
    const name = input.evidence.block_name ?? input.odoo_name;
    return fmt(r.suggests, { name });
  }
  if (input.kind === "combo" && input.excluded_parts?.length) {
    return fmt(r.comboExcluded, { parts: input.excluded_parts.join(", ") });
  }
  if (input.kind === "reventa") {
    return r.resale;
  }
  if (first) return first;
  if (input.kind === "ambiguo") {
    return r.ambiguous;
  }
  if (input.kind === "combo") {
    return input.has_components ? r.comboRecorded : r.comboPending;
  }
  if (input.kind === "sin_receta" || input.kind === "sin_vincular") {
    return r.noRecipeInFile;
  }
  return r.noApprovedCost;
}

export function evidenceSentence(
  evidence: SuggestionEvidenceView,
  lang: PreferredLanguage = DEFAULT_LANG
): string {
  if (evidence.evidence_text) return evidence.evidence_text;
  const e = getDictionary(lang).menu.workspace.copy.evidence;
  const bits: string[] = [];
  if (evidence.block_name) bits.push(`«${evidence.block_name}»`);
  if (evidence.tab) bits.push(fmt(e.sheet, { tab: evidence.tab }));
  if (evidence.excel_match === "match") bits.push(e.matches);
  if (evidence.excel_match === "mismatch") bits.push(e.noMatch);
  return bits.join(" · ") || e.none;
}

export function whoApprovesNote(
  companyName: string | null,
  lang: PreferredLanguage = DEFAULT_LANG
): string {
  const c = getDictionary(lang).menu.workspace.copy;
  const who = companyName?.trim() || c.yourRestaurant;
  return fmt(c.whoApproves, { who });
}

export const COSTING_FOOTERS = {
  resumen:
    "Base: el POS dice qué se vende; el Excel solo aporta recetas y costos.",
  plato:
    "El POS manda: cada plato es un producto real de Odoo. Confirmar el vínculo y aprobar la receta son dos pasos distintos; una receta aprobada se puede revisar sin perder el vínculo.",
  preparaciones:
    "Una preparación aprobada cuenta en todos los platos que la usan. Un borrador no cuenta en ninguno.",
  "menu-costeado":
    "Base: el POS dice qué se vende; el Excel solo aporta recetas y costos.",
} as const;

export function costingFooter(
  view: keyof typeof COSTING_FOOTERS,
  lang: PreferredLanguage = DEFAULT_LANG
): string {
  const f = getDictionary(lang).menu.workspace.copy.footers;
  return view === "plato"
    ? f.plato
    : view === "preparaciones"
      ? f.preparaciones
      : f.resumen;
}

export function isAmbiguousEvidence(evidence: SuggestionEvidenceView): boolean {
  const text = `${evidence.reasons.join(" ")} ${evidence.evidence_text ?? ""}`;
  return /ambigu|2 recetas|más de una receta|2 opciones/i.test(text);
}
