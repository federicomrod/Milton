// lib/restaurant/agents/action-proposals.ts
//
// Deterministic mapping from agent_recommendations → concrete action
// proposals. Pure function over a recommendation row; no I/O.
//
// Each entry returns an `AgentActionProposal` (a draft AgentAction that has
// not been persisted yet). The /agent-actions/propose route is responsible
// for actually inserting them.

import type { AgentRecommendation } from "@/types/agents";
import type {
  AgentAction,
  AgentActionPriority,
  AgentActionType,
} from "@/types/agent-actions";

// ---------------------------------------------------------------------------
// Draft shape
// ---------------------------------------------------------------------------

export type AgentActionProposal = Pick<
  AgentAction,
  | "action_type"
  | "title"
  | "description"
  | "priority"
  | "related_entity_type"
  | "related_entity_id"
  | "payload_json"
  | "impact_json"
>;

// ---------------------------------------------------------------------------
// Defaults / constants
// ---------------------------------------------------------------------------

/** Target margin used for the suggest_price_change formula. The cockpit
 *  flags items below 60% as low margin, so 60 is the natural baseline.
 *  Configurable later via agent_configs. */
const DEFAULT_TARGET_MARGIN_PCT = 60;

const ROUTE_MENU = "/dashboard/restaurant/menu";
const ROUTE_INGREDIENTS = "/dashboard/restaurant/ingredients";
const ROUTE_SUPPLIERS = "/dashboard/restaurant/suppliers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityToPriority(
  sev: AgentRecommendation["severity"]
): AgentActionPriority {
  if (sev === "critical") return "high";
  if (sev === "warning") return "medium";
  return "low";
}

function readNumber(
  obj: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readString(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function roundPeso(amount: number): number {
  return Math.round(amount);
}

/**
 * Suggested price = cost / (1 - target_margin / 100). Returns null when the
 * inputs are missing or yield a non-finite value (e.g. cost so high that the
 * formula explodes for the chosen target margin).
 */
export function computeSuggestedPrice(
  estimatedCost: number | null,
  targetMarginPct: number | null
): number | null {
  if (estimatedCost === null || targetMarginPct === null) return null;
  if (!Number.isFinite(estimatedCost) || !Number.isFinite(targetMarginPct))
    return null;
  if (estimatedCost <= 0) return null;
  if (targetMarginPct <= 0 || targetMarginPct >= 100) return null;
  const raw = estimatedCost / (1 - targetMarginPct / 100);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return roundPeso(raw);
}

// ---------------------------------------------------------------------------
// Per-type builders
// ---------------------------------------------------------------------------

function entityName(rec: AgentRecommendation): string {
  // The runner always puts the entity name in the title; surface a short
  // fallback when it's not parseable.
  return rec.title.length > 0 ? rec.title : "this item";
}

function missingRecipeProposal(rec: AgentRecommendation): AgentActionProposal {
  return {
    action_type: "create_setup_task",
    title: `Create recipe for ${entityName(rec)}`,
    description:
      "The item has revenue but no recipe, so Milton cannot calculate true margin.",
    priority: severityToPriority(rec.severity),
    related_entity_type: "menu_item",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_MENU,
      menu_item_id: rec.related_entity_id,
      recommendation_type: rec.recommendation_type,
    },
    impact_json: rec.impact_json ?? {},
  };
}

function unitMismatchProposal(rec: AgentRecommendation): AgentActionProposal {
  const issueDetails = (
    Array.isArray(rec.impact_json?.issue_paths)
      ? rec.impact_json.issue_paths
      : []
  ) as string[] | undefined;
  return {
    action_type: "review_recipe",
    title: `Fix unit mismatch for ${entityName(rec)}`,
    description:
      "Review the recipe inputs and correct the unit, or update the ingredient's default unit so costing can complete.",
    priority: severityToPriority(rec.severity),
    related_entity_type: "menu_item",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_MENU,
      menu_item_id: rec.related_entity_id,
      issue_details: issueDetails ?? [],
    },
    impact_json: rec.impact_json ?? {},
  };
}

function priceReviewProposal(rec: AgentRecommendation): AgentActionProposal {
  const impact = rec.impact_json ?? {};
  const sellingPrice =
    readNumber(impact, "selling_price") ?? readNumber(impact, "current_price");
  const estimatedCost =
    readNumber(impact, "cost") ?? readNumber(impact, "estimated_cost");
  const currentMargin = readNumber(impact, "gross_margin_pct");
  const targetMargin = DEFAULT_TARGET_MARGIN_PCT;
  const suggestedPrice = computeSuggestedPrice(estimatedCost, targetMargin);

  return {
    action_type: "suggest_price_change",
    title: `Review price for ${entityName(rec)}`,
    description:
      "Milton suggests a price review based on the current recipe cost and a target margin.",
    priority: severityToPriority(rec.severity),
    related_entity_type: "menu_item",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_MENU,
      menu_item_id: rec.related_entity_id,
      current_price: sellingPrice,
      estimated_cost: estimatedCost,
      current_margin_pct: currentMargin,
      target_margin_pct: targetMargin,
      suggested_price: suggestedPrice,
      currency: readString(impact, "currency"),
    },
    impact_json: impact,
  };
}

function priceIncreaseProposal(rec: AgentRecommendation): AgentActionProposal {
  const impact = rec.impact_json ?? {};
  const ingredientName =
    readString(impact, "ingredient_name") ??
    // Title format from the runner: "<name> price up <pct>%". Best-effort
    // parse to give the action a clean title.
    rec.title.replace(/\s+price up.*$/i, "");
  const supplierName = readString(impact, "supplier_name");
  return {
    action_type: "draft_supplier_message",
    title: `Contact supplier about ${ingredientName} price increase`,
    description:
      "Prepare a supplier negotiation or clarification message before paying the new price.",
    priority: severityToPriority(rec.severity),
    related_entity_type: rec.related_entity_type ?? "ingredient",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_INGREDIENTS,
      supplier_name: supplierName,
      ingredient_name: ingredientName,
      previous_cost: readNumber(impact, "previous_cost"),
      latest_cost: readNumber(impact, "latest_cost"),
      pct_change: readNumber(impact, "pct_change"),
      unit: readString(impact, "unit"),
      currency: readString(impact, "currency"),
    },
    impact_json: impact,
  };
}

function supplierConcentrationProposal(
  rec: AgentRecommendation
): AgentActionProposal {
  const impact = rec.impact_json ?? {};
  return {
    action_type: "review_supplier",
    title: `Review dependency on ${entityName(rec).replace(/\s+is\s+\d+%.*$/i, "")}`,
    description:
      "Supplier represents a high share of total spend — consider a secondary supplier for key ingredients.",
    priority: severityToPriority(rec.severity),
    related_entity_type: rec.related_entity_type ?? "supplier",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_SUPPLIERS,
      supplier_spend: readNumber(impact, "supplier_spend"),
      total_spend: readNumber(impact, "total_spend"),
      share_pct: readNumber(impact, "share_pct"),
      currency: readString(impact, "currency"),
    },
    impact_json: impact,
  };
}

function missingSupplierMetadataProposal(
  rec: AgentRecommendation
): AgentActionProposal {
  return {
    action_type: "open_related_record",
    title: `Complete supplier profile for ${entityName(rec).replace(/\s+is missing.*$/i, "")}`,
    description:
      "Add contact details so future supplier workflows (price checks, order changes) can be acted on.",
    priority: severityToPriority(rec.severity),
    related_entity_type: rec.related_entity_type ?? "supplier",
    related_entity_id: rec.related_entity_id,
    payload_json: {
      target_route: ROUTE_SUPPLIERS,
      supplier_id: rec.related_entity_id,
      missing_fields: Array.isArray(rec.impact_json?.missing_fields)
        ? rec.impact_json.missing_fields
        : [],
    },
    impact_json: rec.impact_json ?? {},
  };
}

function fallbackProposal(rec: AgentRecommendation): AgentActionProposal {
  return {
    action_type: "mark_reviewed",
    title: "Review recommendation",
    description:
      "Review the finding and decide whether to take action. Marking this reviewed records the decision without changing data.",
    priority: severityToPriority(rec.severity),
    related_entity_type: rec.related_entity_type,
    related_entity_id: rec.related_entity_id,
    payload_json: {
      recommendation_type: rec.recommendation_type,
    },
    impact_json: rec.impact_json ?? {},
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Returns the deterministic action proposals for a given recommendation.
 *
 * Most recommendation types produce exactly one proposal; we keep the return
 * type as an array so future types (e.g. "draft message + open profile") can
 * propose multiple without an API shape change.
 */
export function proposeActionsForRecommendation(
  rec: AgentRecommendation
): AgentActionProposal[] {
  switch (rec.recommendation_type) {
    case "missing_recipe":
      return [missingRecipeProposal(rec)];
    case "unit_mismatch":
    case "missing_input_cost":
    case "missing_component_recipe":
      return [unitMismatchProposal(rec)];
    case "low_margin":
    case "high_food_cost":
      return [priceReviewProposal(rec)];
    case "price_increase":
      return [priceIncreaseProposal(rec)];
    case "supplier_concentration":
      return [supplierConcentrationProposal(rec)];
    case "missing_supplier_metadata":
      return [missingSupplierMetadataProposal(rec)];
    default:
      return [fallbackProposal(rec)];
  }
}

// ---------------------------------------------------------------------------
// Executability gate
//
// Determines whether the API may transition `approved → executed` (or
// `assigned → executed`) without an external system. For Stage 1 we keep
// this conservative: only `suggest_price_change` is gated as executable, and
// even then we only mark it executed in the next prompt's execution route.
// ---------------------------------------------------------------------------

export const EXECUTABLE_ACTION_TYPES: readonly AgentActionType[] = [
  "suggest_price_change",
] as const;

export function isActionExecutable(
  action: Pick<
    AgentAction,
    "action_type" | "payload_json" | "related_entity_id"
  >
): boolean {
  if (!EXECUTABLE_ACTION_TYPES.includes(action.action_type)) {
    // mark_reviewed / review_recipe / open_related_record etc. don't mutate
    // data; we still let users mark them executed manually because the
    // execution happened in the real world (e.g. they updated the recipe).
    return true;
  }
  // suggest_price_change: require a target identity AND a concrete suggested
  // price before allowing executed transitions.
  const payload = action.payload_json ?? {};
  const hasTarget =
    typeof payload.menu_item_id === "string" ||
    action.related_entity_id !== null;
  const suggested = payload.suggested_price;
  const hasPrice =
    typeof suggested === "number" &&
    Number.isFinite(suggested) &&
    suggested > 0;
  return hasTarget && hasPrice;
}
