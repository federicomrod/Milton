import { can, normalizeRole, type Actor } from "@/lib/auth/capabilities";
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

/** The recipe actor as the shared permissions actor (the rules live in lib/auth). */
export function toPermissionActor(actor: RecipeActor): Actor {
  return {
    userId: actor.user_id,
    companyId: null,
    role: actor.role,
    isMiltonStaff: actor.is_milton_staff,
  };
}

/** A resolved permissions actor as the recipe actor the services take. */
export function toRecipeActor(actor: Actor): RecipeActor {
  return {
    user_id: actor.userId,
    role: actor.role,
    is_milton_staff: actor.isMiltonStaff,
  };
}

export function actorCanApproveDirectly(actor: RecipeActor): boolean {
  // Owner / admin by role; Milton staff are not "direct" (they confirm for the client).
  return can(
    { ...toPermissionActor(actor), isMiltonStaff: false },
    "recipes.approve"
  );
}

export function actorNeedsClientConfirmation(actor: RecipeActor): boolean {
  return actor.is_milton_staff && !actorCanApproveDirectly(actor);
}

export function actorCanSubmitForApproval(actor: RecipeActor): boolean {
  return can(toPermissionActor(actor), "recipes.submit");
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
  if (normalizeRole(actor.role) === "manager" && !actor.is_milton_staff) {
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

/** May this person link, change or undo POS products? (links.confirm) */
export function actorCanLinkProducts(actor: RecipeActor): boolean {
  return can(toPermissionActor(actor), "links.confirm");
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

function computedMiltonCost(evidence: SuggestionEvidenceView): number | null {
  if (evidence.milton_cost != null && Number.isFinite(evidence.milton_cost)) {
    return evidence.milton_cost;
  }
  if (evidence.lines.length === 0) return null;
  if (evidence.lines.some((line) => line.pending || line.unit_cost == null)) {
    return null;
  }
  const total = evidence.lines.reduce(
    (sum, line) => sum + line.qty * (line.unit_cost ?? 0),
    0
  );
  return Number.isFinite(total) && total >= 0 ? total : null;
}

export function buildApprovalChecklist(input: {
  link_state: string | null;
  evidence: SuggestionEvidenceView;
  yield_confirmed?: boolean;
  odoo_name?: string | null;
  odoo_product_id?: number | null;
}): ApprovalChecklist {
  const linked = input.link_state === "confirmado";
  const hasLines = input.evidence.lines.length > 0;
  const noPending =
    hasLines && !input.evidence.lines.some((line) => line.pending);
  const unitsValid = hasLines && !input.evidence.lines.some(hasPendingUnit);
  const pricesPresent = hasLines && !input.evidence.lines.some(hasPendingPrice);
  const yieldValue = input.evidence.yield.value;
  const yieldSource = input.evidence.yield.source;
  const hasKnownYield =
    yieldValue != null && yieldValue > 0 && Boolean(yieldSource);
  // A dish is one plate. A preparation's yield is confirmed in
  // Preparaciones, never on the dish: an assumed yield here no longer
  // blocks (a preparation line without a cost already does).
  const yieldConfirmed = hasKnownYield;
  const miltonCost = computedMiltonCost(input.evidence);
  // 0 is a cost when every line is priced (a preparation of water);
  // "no cost" is null.
  const hasComputedCost = miltonCost != null && miltonCost >= 0;
  const excelMatch = input.evidence.excel_match;
  const excelOk = excelMatch === "match";
  const yieldName =
    input.evidence.lines.find((line) => line.sub_recipe_match)?.raw_name ??
    null;

  const blockers: string[] = [];
  if (!hasLines) blockers.push("La receta no tiene ingredientes.");
  if (!hasComputedCost) {
    blockers.push("La receta no tiene un costo calculado.");
  }
  if (!hasKnownYield) {
    blockers.push("La receta no tiene un rendimiento conocido.");
  }
  if (!noPending && hasLines) {
    blockers.push("Hay líneas pendientes. No dejes ninguna en $0.");
  }
  if (hasKnownYield && !yieldConfirmed) {
    blockers.push("Confirma el rendimiento antes de aprobar.");
  }
  if (!unitsValid && hasLines) {
    blockers.push("Hay unidades que no se pueden convertir.");
  }

  const items: ApprovalChecklist["items"] = [
    {
      id: "linked",
      ok: linked,
      warn: !linked,
      label: linked
        ? input.odoo_name && input.odoo_product_id
          ? `Vinculado al POS: ${input.odoo_name} (Odoo #${input.odoo_product_id})`
          : "Vinculado al POS"
        : "Todavía no está Confirmado el vínculo con el POS",
    },
    {
      id: "ingredients",
      ok: hasLines,
      warn: !hasLines,
      label: hasLines
        ? "La receta tiene ingredientes"
        : "La receta no tiene ingredientes",
    },
    {
      id: "prices",
      ok: pricesPresent,
      warn: !pricesPresent,
      label: !hasLines
        ? "La receta no tiene ingredientes"
        : pricesPresent
          ? "Todos los ingredientes tienen precio"
          : "Falta el precio de al menos un ingrediente",
    },
    {
      id: "units",
      ok: unitsValid,
      warn: !unitsValid,
      label: !hasLines
        ? "La receta no tiene ingredientes"
        : unitsValid
          ? "Todas las unidades se pueden convertir"
          : "Hay unidades que no se pueden convertir",
    },
    {
      id: "yield",
      ok: yieldConfirmed,
      warn: !yieldConfirmed,
      label: !hasKnownYield
        ? "La receta no tiene un rendimiento conocido"
        : yieldConfirmed
          ? "Rendimiento confirmado"
          : yieldName
            ? `Rendimiento de ${yieldName} por confirmar`
            : "Rendimiento por confirmar",
    },
    {
      id: "cost",
      ok: hasComputedCost,
      warn: !hasComputedCost,
      label: hasComputedCost
        ? "La receta tiene un costo calculado"
        : "La receta no tiene un costo calculado",
    },
    {
      id: "excel",
      ok: excelOk,
      warn: !excelOk && excelMatch !== "mismatch",
      label: excelOk
        ? "Cuadra con Excel"
        : excelMatch === "mismatch"
          ? "Diferencia con Excel mayor a 2% o $0.05 (o explícala)"
          : "Sin dato de Excel para comparar",
    },
  ];

  return {
    linked_to_pos: linked,
    no_pending_lines: noPending,
    yield_confirmed: yieldConfirmed,
    units_valid: unitsValid,
    prices_present: pricesPresent,
    excel_within_tolerance: excelOk,
    ready:
      hasLines &&
      hasComputedCost &&
      hasKnownYield &&
      noPending &&
      yieldConfirmed &&
      unitsValid &&
      pricesPresent,
    blockers,
    items,
  };
}
