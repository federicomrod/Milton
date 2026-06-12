// lib/restaurant/ask-milton-actions.ts
//
// Deterministic suggested-action generator for Ask Milton Stage 2.
//
// Rules:
//   - Returns up to MAX_ACTIONS chips per answer.
//   - Never invents IDs — if a required ID is missing, the action is skipped.
//   - Navigation-only chips (creates_agent_action: false) use target_route.
//   - Agent-action chips (creates_agent_action: true) are proposals only;
//     nothing is written until the user confirms in the UI.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { AskMiltonIntent } from "@/lib/restaurant/ask-milton-prompt";
import type { AgentActionPriority } from "@/types/agent-actions";

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

export interface SuggestedAction {
  label: string;
  /** Valid AgentActionType for creates_agent_action=true chips; "navigation"
   *  for nav-only chips where no DB row is created. */
  action_type: string;
  agent_key: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  payload_json: Record<string, unknown>;
  impact_json: Record<string, unknown>;
  priority: AgentActionPriority;
  /** When true, clicking "Create action" POSTs to create-action endpoint.
   *  When false, clicking navigates to target_route directly. */
  creates_agent_action: boolean;
  target_route: string | null;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const MAX_ACTIONS = 3;
const DEFAULT_TARGET_MARGIN_PCT = 60;
const HIGH_FOOD_COST_THRESHOLD = 40;
const LOW_MARGIN_THRESHOLD = 35;

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateSuggestedActions(
  message: string,
  ctx: AskMiltonContext,
  intent: AskMiltonIntent
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const m = message.toLowerCase();
  const has = (...words: string[]) => words.some((w) => m.includes(w));

  const add = (a: SuggestedAction) => {
    if (actions.length < MAX_ACTIONS) actions.push(a);
  };

  // -------------------------------------------------------------------------
  // 1. Low margin / high food cost dishes → suggest_price_change
  // -------------------------------------------------------------------------
  const wantsMarginFix =
    intent === "least_profitable_dishes" ||
    intent === "agent_recommendations" ||
    has(
      "margin",
      "food cost",
      "profit",
      "fix",
      "price",
      "this week",
      "high food cost"
    );

  if (wantsMarginFix) {
    const candidates = ctx.menu.least_profitable_items.filter(
      (item) =>
        item.menu_item_id &&
        item.selling_price != null &&
        item.estimated_cost != null &&
        ((item.food_cost_pct != null &&
          item.food_cost_pct > HIGH_FOOD_COST_THRESHOLD) ||
          item.gross_margin_pct < LOW_MARGIN_THRESHOLD)
    );

    for (const item of candidates.slice(0, 2)) {
      if (actions.length >= MAX_ACTIONS) break;

      const isHighPriority =
        (item.food_cost_pct != null &&
          item.food_cost_pct > HIGH_FOOD_COST_THRESHOLD) ||
        item.gross_margin_pct < LOW_MARGIN_THRESHOLD * 0.6;

      // Suggested price to hit DEFAULT_TARGET_MARGIN_PCT: cost / (1 - margin)
      let suggestedPrice: number | null = null;
      if (item.estimated_cost != null) {
        suggestedPrice = parseFloat(
          (item.estimated_cost / (1 - DEFAULT_TARGET_MARGIN_PCT / 100)).toFixed(
            2
          )
        );
      }

      add({
        label: `Create price review action for ${item.name}`,
        action_type: "suggest_price_change",
        agent_key: "recipe_margin_agent",
        related_entity_type: "menu_item",
        related_entity_id: item.menu_item_id,
        payload_json: {
          menu_item_id: item.menu_item_id,
          menu_item_name: item.name,
          current_price: item.selling_price,
          estimated_cost: item.estimated_cost,
          current_margin_pct: item.gross_margin_pct,
          target_margin_pct: DEFAULT_TARGET_MARGIN_PCT,
          ...(suggestedPrice != null
            ? { suggested_price: suggestedPrice }
            : {}),
        },
        impact_json: {
          food_cost_pct: item.food_cost_pct,
          gross_profit_per_item: item.gross_profit_per_item,
        },
        priority: isHighPriority ? "high" : "medium",
        creates_agent_action: true,
        target_route: "/dashboard/restaurant/menu",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Missing recipe → create_setup_task
  // -------------------------------------------------------------------------
  const wantsMissingRecipe =
    intent === "missing_recipes" ||
    intent === "agent_recommendations" ||
    has(
      "missing recipe",
      "no recipe",
      "without recipe",
      "recipe missing",
      "this week",
      "fix"
    );

  if (wantsMissingRecipe) {
    const missingItems = ctx.briefing.high_revenue_missing_recipe ?? [];
    for (const item of missingItems.slice(0, 2)) {
      if (actions.length >= MAX_ACTIONS) break;
      if (!item.menu_item_id) continue;

      add({
        label: `Create recipe task for ${item.name}`,
        action_type: "create_setup_task",
        agent_key: "recipe_margin_agent",
        related_entity_type: "menu_item",
        related_entity_id: item.menu_item_id,
        payload_json: {
          menu_item_id: item.menu_item_id,
          menu_item_name: item.name,
          target_route: "/dashboard/restaurant/menu",
          reason: "missing_recipe",
        },
        impact_json: {},
        priority: "high",
        creates_agent_action: true,
        target_route: "/dashboard/restaurant/menu",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Unit mismatch / costing blocker → review_recipe
  // -------------------------------------------------------------------------
  const wantsCostingFix =
    intent === "cost_coverage" ||
    has(
      "unit mismatch",
      "costing blocker",
      "unit issue",
      "coverage incomplete",
      "costing incomplete",
      "unit problem"
    );

  if (wantsCostingFix) {
    const blockers = (ctx.briefing.costing_blockers ?? []).filter(
      (b) => b.menu_item_id && b.status === "missing_unit_conversion"
    );
    for (const blocker of blockers.slice(0, 1)) {
      if (actions.length >= MAX_ACTIONS) break;

      add({
        label: `Create fix-unit task for ${blocker.name}`,
        action_type: "review_recipe",
        agent_key: "recipe_margin_agent",
        related_entity_type: "menu_item",
        related_entity_id: blocker.menu_item_id,
        payload_json: {
          menu_item_id: blocker.menu_item_id,
          menu_item_name: blocker.name,
          target_route: "/dashboard/restaurant/menu",
          reason: "unit_mismatch",
          blocker_message: blocker.message,
        },
        impact_json: {},
        priority: "high",
        creates_agent_action: true,
        target_route: "/dashboard/restaurant/menu",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Supplier price increase / supplier risk → review_supplier
  //
  // Requires a resolvable supplier_id — skip if we can't match by name.
  // -------------------------------------------------------------------------
  const wantsSupplierReview =
    intent === "supplier_risk" ||
    has(
      "supplier",
      "vendor",
      "price increase",
      "price went up",
      "supplier risk"
    );

  if (wantsSupplierReview) {
    const priceRisks = ctx.briefing.supplier_price_increases ?? [];
    // Build lookup maps from the two sources that carry supplier_id
    const supplierById = new Map<string, string>(); // name.lower → supplier_id
    for (const s of ctx.suppliers.top) {
      if (s.supplier_id && s.name) {
        supplierById.set(s.name.toLowerCase(), s.supplier_id);
      }
    }
    for (const s of ctx.briefing.top_suppliers ?? []) {
      if (s.supplier_id && s.supplier_name) {
        supplierById.set(s.supplier_name.toLowerCase(), s.supplier_id);
      }
    }

    for (const risk of priceRisks.slice(0, 1)) {
      if (actions.length >= MAX_ACTIONS) break;
      if (!risk.supplier_name) continue;

      const supplierId =
        supplierById.get(risk.supplier_name.toLowerCase()) ?? null;
      if (!supplierId) continue; // can't suggest without a valid supplier_id

      const isHighSeverity = risk.pct_change > 20;
      add({
        label: `Create supplier review action for ${risk.supplier_name}`,
        action_type: "review_supplier",
        agent_key: "supplier_agent",
        related_entity_type: "supplier",
        related_entity_id: supplierId,
        payload_json: {
          supplier_id: supplierId,
          supplier_name: risk.supplier_name,
          reason: "price_increase",
          ingredient_name: risk.ingredient_name,
          pct_change: risk.pct_change,
          target_route: "/dashboard/restaurant/suppliers",
        },
        impact_json: {
          pct_change: risk.pct_change,
          ingredient_name: risk.ingredient_name,
        },
        priority: isHighSeverity ? "high" : "medium",
        creates_agent_action: true,
        target_route: "/dashboard/restaurant/suppliers",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Invoices needing review → navigation chip
  // -------------------------------------------------------------------------
  const wantsInvoiceReview =
    intent === "invoices_needing_review" ||
    has("invoice", "review invoice", "pending invoice");

  if (wantsInvoiceReview && ctx.invoices.needs_review_count > 0) {
    add({
      label: `Review pending invoices (${ctx.invoices.needs_review_count})`,
      action_type: "navigation",
      agent_key: null,
      related_entity_type: null,
      related_entity_id: null,
      payload_json: {},
      impact_json: {},
      priority: "medium",
      creates_agent_action: false,
      target_route: "/dashboard/restaurant/invoices",
    });
  }

  // -------------------------------------------------------------------------
  // 6. Data quality / cost coverage incomplete → navigation chip
  // -------------------------------------------------------------------------
  const hasDataIssues =
    ctx.briefing.data_quality.menu_items_without_recipe > 0 ||
    ctx.briefing.data_quality.recipes_with_unit_mismatch > 0 ||
    ctx.briefing.data_quality.ingredients_without_cost_entries > 0;

  const wantsDataQuality =
    intent === "cost_coverage" ||
    (intent === "agent_recommendations" && hasDataIssues) ||
    has("coverage", "data quality", "missing data", "setup");

  if (wantsDataQuality && ctx.agent_actions.open.length > 0) {
    add({
      label: "Open setup / data quality issues",
      action_type: "navigation",
      agent_key: null,
      related_entity_type: null,
      related_entity_id: null,
      payload_json: {},
      impact_json: {},
      priority: "medium",
      creates_agent_action: false,
      target_route: "/dashboard/restaurant/agents",
    });
  }

  return actions;
}
