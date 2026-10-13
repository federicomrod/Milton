import {
  workbookMatchLabel,
  workbookMismatchReason,
} from "@/lib/restaurant/cost-workbook/copy";
import type { SuggestionEvidenceView } from "./evidence";
import { formatMoneyEs, formatPctLabel } from "./format";

export const CONFIRMED_HOW_OPTIONS = [
  { value: "en_pantalla", label: "En esta pantalla" },
  { value: "en_persona", label: "En persona" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "correo", label: "Correo" },
  { value: "llamada", label: "Llamada" },
] as const;

export type ConfirmedHow = (typeof CONFIRMED_HOW_OPTIONS)[number]["value"];

export function isConfirmedHow(value: unknown): value is ConfirmedHow {
  return (
    typeof value === "string" &&
    CONFIRMED_HOW_OPTIONS.some((option) => option.value === value)
  );
}

export function confirmedHowLabel(value: string): string {
  return (
    CONFIRMED_HOW_OPTIONS.find((option) => option.value === value)?.label ??
    value
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

export function excelTabSummary(input: {
  excel_match: "match" | "mismatch" | null;
  pending: boolean;
  reasons: readonly string[];
  currency?: string;
  milton_cost?: number | null;
  excel_total?: number | null;
}): string {
  if (!input.pending && input.excel_match === "match") {
    return workbookMatchLabel("es");
  }
  const first = input.reasons.find((reason) => reason.trim()) ?? null;
  if (first) return first;
  if (input.excel_match === "mismatch") {
    return workbookMismatchReason(
      "es",
      input.excel_total ?? null,
      input.milton_cost ?? null
    );
  }
  return "Esta pestaña tiene líneas por revisar.";
}

export function productReason(input: {
  kind: TodoKind;
  evidence: SuggestionEvidenceView;
  odoo_name: string;
  is_combo: boolean;
  has_components: boolean;
  currency?: string;
}): string {
  const first = input.evidence.reasons.find((reason) => reason.trim());
  if (input.kind === "falta_precio") {
    const line = input.evidence.lines.find((row) => row.pending);
    return (
      first ??
      (line
        ? `Falta el precio de ${line.raw_name}.`
        : "Falta el precio de un ingrediente.")
    );
  }
  if (
    input.kind === "por_revisar" &&
    input.evidence.excel_match === "mismatch"
  ) {
    const milton =
      input.evidence.milton_cost != null
        ? formatMoneyEs(input.evidence.milton_cost, input.currency)
        : "sin costo";
    const excel =
      input.evidence.excel_total != null
        ? formatMoneyEs(input.evidence.excel_total, input.currency)
        : "sin dato";
    const pct =
      input.evidence.variance_pct != null
        ? formatPctLabel(Math.abs(input.evidence.variance_pct))
        : null;
    const gap = pct ? ` es ${pct} menor` : " no coincide";
    const sentence = `El costo de Milton (${milton})${gap} que tu Excel (${excel}).`;
    if (first && !/excel|costo de milton/i.test(first)) {
      return `${sentence} ${first}`;
    }
    return sentence;
  }
  if (input.kind === "sugerido") {
    const name = input.evidence.block_name ?? input.odoo_name;
    return `Milton sugiere «${name}». Confírmalo.`;
  }
  if (input.kind === "reventa") {
    return "Se vende como lo compras: elige qué compras y su costo es lo que pagas.";
  }
  if (first) return first;
  if (input.kind === "ambiguo") {
    return "Hay más de una receta posible en tu archivo. Elige una.";
  }
  if (input.kind === "combo") {
    return input.has_components
      ? "Odoo registra cada parte vendida."
      : "Pendiente: combo";
  }
  if (input.kind === "sin_receta" || input.kind === "sin_vincular") {
    return "No hay receta en tu archivo para este plato.";
  }
  return "Este plato todavía no tiene un costo aprobado.";
}

export function evidenceSentence(evidence: SuggestionEvidenceView): string {
  if (evidence.evidence_text) return evidence.evidence_text;
  const bits: string[] = [];
  if (evidence.block_name) bits.push(`«${evidence.block_name}»`);
  if (evidence.tab) bits.push(`hoja ${evidence.tab}`);
  if (evidence.excel_match === "match") bits.push("cuadra con tu Excel");
  if (evidence.excel_match === "mismatch") bits.push("no cuadra con tu Excel");
  return bits.join(" · ") || "Sin evidencia todavía";
}

export function whoApprovesNote(companyName: string | null): string {
  const who = companyName?.trim() || "tu restaurante";
  return `Quién aprueba: el dueño o un admin de ${who}. Milton prepara; una persona confirma.`;
}

export const COSTING_FOOTERS = {
  resumen:
    "Base: el POS dice qué se vende; el Excel solo aporta recetas y costos.",
  vincular:
    "El POS manda: cada fila es un producto real de Odoo con su ID. Lo confirmado por una persona nunca lo pisa una nueva importación.",
  validar:
    "Estados de una receta: Importada → Borrador → Lista para aprobar → Aprobada (versionada) → Necesita revisión si cambia un precio o sub-receta.",
  preparaciones:
    "Una preparación aprobada cuenta en todos los platos que la usan. Un borrador no cuenta en ninguno.",
  "menu-costeado":
    "Base: el POS dice qué se vende; el Excel solo aporta recetas y costos.",
} as const;

export function isAmbiguousEvidence(evidence: SuggestionEvidenceView): boolean {
  const text = `${evidence.reasons.join(" ")} ${evidence.evidence_text ?? ""}`;
  return /ambigu|2 recetas|más de una receta|2 opciones/i.test(text);
}
