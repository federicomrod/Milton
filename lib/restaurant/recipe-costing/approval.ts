import { can, normalizeRole, type Actor } from "@/lib/auth/capabilities";
import { fmt, getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
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
  },
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): { ok: true } | { ok: false; error: string } {
  const e = getDictionary(lang).menu.workspace.approval.error;
  if (actorCanApproveDirectly(actor)) return { ok: true };
  if (normalizeRole(actor.role) === "manager" && !actor.is_milton_staff) {
    return {
      ok: false,
      error: e.managerCannotApprove,
    };
  }
  if (actor.is_milton_staff) {
    const missing = confirmPosProductLinkError(confirmation);
    if (missing) {
      return {
        ok: false,
        error: e.staffNeedsHow,
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    error: e.ownerOnly,
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
  },
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): { ok: true } | { ok: false; error: string } {
  const e = getDictionary(lang).menu.workspace.approval.error;
  if (actorNeedsClientConfirmation(actor)) {
    const missing = confirmPosProductLinkError(confirmation);
    if (missing) {
      return {
        ok: false,
        error: e.clientNeedsHow,
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
  lang?: PreferredLanguage;
}): ApprovalChecklist {
  const a = getDictionary(input.lang ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE)
    .menu.workspace.approval;
  const b = a.blocker;
  const it = a.item;
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
  if (!hasLines) blockers.push(b.noIngredients);
  if (!hasComputedCost) {
    blockers.push(b.noCost);
  }
  if (!hasKnownYield) {
    blockers.push(b.noYield);
  }
  if (!noPending && hasLines) {
    blockers.push(b.pendingLines);
  }
  if (hasKnownYield && !yieldConfirmed) {
    blockers.push(b.confirmYield);
  }
  if (!unitsValid && hasLines) {
    blockers.push(b.unitsNotConvertible);
  }

  const items: ApprovalChecklist["items"] = [
    {
      id: "linked",
      ok: linked,
      warn: !linked,
      label: linked
        ? input.odoo_name && input.odoo_product_id
          ? fmt(it.linkedTo, {
              name: input.odoo_name,
              id: input.odoo_product_id,
            })
          : it.linked
        : it.notLinked,
    },
    {
      id: "ingredients",
      ok: hasLines,
      warn: !hasLines,
      label: hasLines ? it.hasIngredients : it.noIngredients,
    },
    {
      id: "prices",
      ok: pricesPresent,
      warn: !pricesPresent,
      label: !hasLines
        ? it.noIngredients
        : pricesPresent
          ? it.allPriced
          : it.somePriceMissing,
    },
    {
      id: "units",
      ok: unitsValid,
      warn: !unitsValid,
      label: !hasLines
        ? it.noIngredients
        : unitsValid
          ? it.unitsOk
          : it.unitsBad,
    },
    {
      id: "yield",
      ok: yieldConfirmed,
      warn: !yieldConfirmed,
      label: !hasKnownYield
        ? it.yieldUnknown
        : yieldConfirmed
          ? it.yieldConfirmed
          : yieldName
            ? fmt(it.yieldOfToConfirm, { name: yieldName })
            : it.yieldToConfirm,
    },
    {
      id: "cost",
      ok: hasComputedCost,
      warn: !hasComputedCost,
      label: hasComputedCost ? it.costOk : it.costNo,
    },
    {
      id: "excel",
      ok: excelOk,
      warn: !excelOk && excelMatch !== "mismatch",
      label: excelOk
        ? it.excelOk
        : excelMatch === "mismatch"
          ? it.excelDiff
          : it.excelNone,
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
