import { confirmPosProductLinkError } from "@/lib/restaurant/pos-product-links";
import type { SuggestionEvidenceView, SuggestionLineView } from "./evidence";

export type RecipeActorRole =
  | "owner"
  | "admin"
  | "manager"
  | "analyst"
  | "viewer"
  | "member"
  | string;

export interface RecipeActor {
  user_id: string;
  role: RecipeActorRole | null;
  is_milton_staff: boolean;
}

export interface ApprovalChecklist {
  linked_to_pos: boolean;
  no_pending_lines: boolean;
  yield_confirmed: boolean;
  units_valid: boolean;
  prices_present: boolean;
  excel_within_tolerance: boolean;
  ready: boolean;
  blockers: string[];
  items: Array<{
    id: string;
    ok: boolean;
    warn: boolean;
    label: string;
  }>;
}

export function actorCanApproveDirectly(actor: RecipeActor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

export function actorNeedsClientConfirmation(actor: RecipeActor): boolean {
  return actor.is_milton_staff && !actorCanApproveDirectly(actor);
}

export function actorCanSubmitForApproval(actor: RecipeActor): boolean {
  return (
    actorCanApproveDirectly(actor) ||
    actor.role === "manager" ||
    actor.is_milton_staff
  );
}

export function actorCanApprove(
  actor: RecipeActor,
  confirmation?: {
    confirmed_by?: string;
    confirmed_at?: string;
    confirmed_how?: string;
  }
): { ok: true } | { ok: false; error: string } {
  if (actorCanApproveDirectly(actor)) return { ok: true };
  if (actor.role === "manager" && !actor.is_milton_staff) {
    return {
      ok: false,
      error:
        "Como gerente puedes enviar a aprobación, pero solo el dueño o un admin aprueba.",
    };
  }
  if (actor.is_milton_staff) {
    const missing = confirmPosProductLinkError(confirmation);
    if (missing) {
      return {
        ok: false,
        error:
          "Si apruebas en nombre del cliente, registra cómo lo confirmó (quién, cuándo y cómo).",
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    error: "Solo el dueño o un admin puede aprobar esta receta.",
  };
}

export function actorCanConfirmLink(
  actor: RecipeActor,
  confirmation?: {
    confirmed_by?: string;
    confirmed_at?: string;
    confirmed_how?: string;
  }
): { ok: true } | { ok: false; error: string } {
  if (actorNeedsClientConfirmation(actor)) {
    const missing = confirmPosProductLinkError(confirmation);
    if (missing) {
      return {
        ok: false,
        error:
          "Si confirmas en nombre del cliente, indica cómo lo confirmó (en persona, WhatsApp, correo o llamada).",
      };
    }
  }
  const missing = confirmPosProductLinkError(confirmation);
  if (missing) return { ok: false, error: missing };
  return { ok: true };
}

function hasPendingUnit(line: SuggestionLineView): boolean {
  return (
    line.pending &&
    (line.flags.includes("pendiente_unidad") ||
      line.reasons.some((reason) => /unidad|unit/i.test(reason)))
  );
}

function hasPendingPrice(line: SuggestionLineView): boolean {
  return (
    line.pending &&
    (line.flags.includes("pendiente_costo") ||
      line.unit_cost == null ||
      line.reasons.some((reason) => /costo|precio|cost/i.test(reason)))
  );
}

export function buildApprovalChecklist(input: {
  link_state: string | null;
  evidence: SuggestionEvidenceView;
  yield_confirmed?: boolean;
}): ApprovalChecklist {
  const linked = input.link_state === "confirmado";
  const noPending = !input.evidence.lines.some((line) => line.pending);
  const unitsValid = !input.evidence.lines.some(hasPendingUnit);
  const pricesPresent = !input.evidence.lines.some(hasPendingPrice);
  const yieldAssumed =
    input.evidence.yield.source === "assumed" ||
    input.evidence.reasons.some((reason) =>
      /rendimiento asumido|assumed yield/i.test(reason)
    );
  const yieldConfirmed = input.yield_confirmed ?? !yieldAssumed;
  const excelOk = input.evidence.excel_match !== "mismatch";

  const blockers: string[] = [];
  if (!noPending)
    blockers.push("Hay líneas pendientes. No dejes ninguna en $0.");
  if (!yieldConfirmed)
    blockers.push("Confirma el rendimiento antes de aprobar.");
  if (!unitsValid) blockers.push("Hay unidades que no se pueden convertir.");

  const items: ApprovalChecklist["items"] = [
    {
      id: "linked",
      ok: linked,
      warn: !linked,
      label: linked
        ? "Vinculado al POS"
        : "Todavía no está Confirmado el vínculo con el POS",
    },
    {
      id: "prices",
      ok: pricesPresent,
      warn: !pricesPresent,
      label: pricesPresent
        ? "Todos los ingredientes tienen precio"
        : "Falta el precio de al menos un ingrediente",
    },
    {
      id: "units",
      ok: unitsValid,
      warn: !unitsValid,
      label: unitsValid
        ? "Todas las unidades se pueden convertir"
        : "Hay unidades que no se pueden convertir",
    },
    {
      id: "yield",
      ok: yieldConfirmed,
      warn: !yieldConfirmed,
      label: yieldConfirmed
        ? "Rendimiento confirmado"
        : "Rendimiento por confirmar",
    },
    {
      id: "excel",
      ok: excelOk,
      warn: !excelOk,
      label: excelOk
        ? "Cuadra con Excel"
        : "Diferencia con Excel mayor a 2% o $0.05 (o explícala)",
    },
  ];

  return {
    linked_to_pos: linked,
    no_pending_lines: noPending,
    yield_confirmed: yieldConfirmed,
    units_valid: unitsValid,
    prices_present: pricesPresent,
    excel_within_tolerance: excelOk,
    ready: noPending && yieldConfirmed && unitsValid,
    blockers,
    items,
  };
}
