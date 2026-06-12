// app/api/restaurant/agent-actions/execute/route.ts
//
// POST /api/restaurant/agent-actions/execute
//   Body: { action_id: string }
//
// Stage 3 — controlled execution for approved/assigned `suggest_price_change`
// actions. The only data this endpoint mutates is Milton's internal
// `menu_items.selling_price` for the linked menu item. No POS / delivery
// platform / external system is touched.
//
// Safety rules (enforced top-to-bottom; first violation returns):
//   * Authenticated user only.
//   * Action must belong to the caller's company (RLS + explicit eq).
//   * Action.action_type must be `suggest_price_change`.
//   * Action.status must be `approved` or `assigned`. Any other status is
//     rejected with 409 (executed/verified/rejected/cancelled/proposed).
//   * Payload must include a positive numeric `suggested_price` AND a menu
//     item identity (payload.menu_item_id OR action.related_entity_id).
//   * The menu item must exist for the same company.
//   * If the menu item's current `selling_price` differs from the action's
//     `payload.current_price`, the route refuses with a conflict error
//     ("price changed since this action was proposed").
//
// Sequence (no native multi-statement transactions through PostgREST; we
// keep the order short and fail safely):
//   1. Read menu_items.selling_price.
//   2. Validate against payload.current_price.
//   3. UPDATE menu_items.selling_price.
//   4. UPDATE agent_actions to status=executed (with executed_by + at +
//      outcome_notes). If this fails, log and surface — the price write
//      already happened but the action stays approved (the next attempt will
//      detect "no drift" because payload.current_price still matches the
//      pre-write price; we additionally re-check below).
//   5. INSERT agent_action_events with old/new price metadata.
//
// The brief documents the column as `menu_items.price`; the actual column
// in this codebase is `selling_price` (see profitability-server.ts,
// menu-recipes-server.ts, types/restaurant.ts). We write to selling_price.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import type { AgentAction } from "@/types/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTION_SELECT =
  "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at";

// How close two prices have to be to be considered "the same". Money is
// stored as numeric in Postgres; we still tolerate a 0.005 epsilon so a
// rounded peso comparison doesn't fail on a stored 280.0000 vs payload 280.
const PRICE_EPSILON = 0.005;

function readNumber(
  obj: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;

  // ---- Parse + validate body ----
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const actionId = typeof body.action_id === "string" ? body.action_id : "";
  if (!actionId) {
    return NextResponse.json(
      { error: "action_id is required" },
      { status: 400 }
    );
  }

  // ---- Load action ----
  const { data: actionRow, error: loadErr } = await supabase
    .from("agent_actions")
    .select(ACTION_SELECT)
    .eq("company_id", companyId)
    .eq("id", actionId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json(
      { error: "Action lookup failed", details: loadErr.message },
      { status: 500 }
    );
  }
  if (!actionRow) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }
  const action = actionRow as AgentAction;

  // ---- Eligibility checks ----
  if (action.action_type !== "suggest_price_change") {
    return NextResponse.json(
      {
        error: `Execution is only supported for suggest_price_change actions (got ${action.action_type}).`,
      },
      { status: 400 }
    );
  }
  if (action.status !== "approved" && action.status !== "assigned") {
    return NextResponse.json(
      {
        error: `Action must be approved or assigned before execution (current status: ${action.status}).`,
      },
      { status: 409 }
    );
  }

  // ---- Resolve target menu item identity ----
  const payload = action.payload_json ?? {};
  const menuItemIdFromPayload =
    typeof payload.menu_item_id === "string"
      ? (payload.menu_item_id as string)
      : null;
  const menuItemId =
    menuItemIdFromPayload ??
    (action.related_entity_type === "menu_item"
      ? action.related_entity_id
      : null);
  if (!menuItemId) {
    return NextResponse.json(
      {
        error:
          "Action is missing a target menu_item_id in payload_json or related_entity_id.",
      },
      { status: 400 }
    );
  }

  // ---- Validate suggested price ----
  const suggestedPrice = readNumber(payload, "suggested_price");
  if (suggestedPrice === null || suggestedPrice <= 0) {
    return NextResponse.json(
      {
        error:
          "payload_json.suggested_price must be a positive number — cannot execute.",
      },
      { status: 400 }
    );
  }

  // ---- Load menu item under the same company ----
  const { data: menuItem, error: miErr } = await supabase
    .from("menu_items")
    .select("id, name, selling_price, currency, company_id")
    .eq("company_id", companyId)
    .eq("id", menuItemId)
    .maybeSingle();
  if (miErr) {
    return NextResponse.json(
      { error: "Menu item lookup failed", details: miErr.message },
      { status: 500 }
    );
  }
  if (!menuItem) {
    return NextResponse.json(
      {
        error: `Linked menu item (${menuItemId}) was not found for this company.`,
      },
      { status: 404 }
    );
  }

  // ---- Drift detection ----
  const dbCurrentPrice =
    typeof menuItem.selling_price === "number" &&
    Number.isFinite(menuItem.selling_price)
      ? (menuItem.selling_price as number)
      : null;
  const payloadCurrentPrice = readNumber(payload, "current_price");
  if (
    dbCurrentPrice !== null &&
    payloadCurrentPrice !== null &&
    Math.abs(dbCurrentPrice - payloadCurrentPrice) > PRICE_EPSILON
  ) {
    return NextResponse.json(
      {
        error:
          "Menu price changed since this action was proposed. Please review and create a new action.",
        details: {
          payload_current_price: payloadCurrentPrice,
          db_current_price: dbCurrentPrice,
        },
        conflict: "price_drift",
      },
      { status: 409 }
    );
  }

  const oldPrice = dbCurrentPrice;
  const newPrice = Math.round(suggestedPrice * 100) / 100;

  // ---- 1) Update the menu item ----
  const { data: updatedMenuItem, error: miUpdErr } = await supabase
    .from("menu_items")
    .update({ selling_price: newPrice })
    .eq("company_id", companyId)
    .eq("id", menuItemId)
    .select("id, name, selling_price, currency")
    .single();
  if (miUpdErr || !updatedMenuItem) {
    console.error(
      "[agent-actions/execute] menu_items update:",
      miUpdErr?.message
    );
    return NextResponse.json(
      {
        error: "Could not update menu item price.",
        details: miUpdErr?.message,
      },
      { status: 500 }
    );
  }

  // ---- 2) Transition the action to executed ----
  const estimatedCost = readNumber(payload, "estimated_cost");
  const targetMarginPct = readNumber(payload, "target_margin_pct");
  const expectedMarginAfter =
    estimatedCost !== null && newPrice > 0
      ? Math.round(((newPrice - estimatedCost) / newPrice) * 1000) / 10
      : null;
  const currencyForLog =
    (typeof menuItem.currency === "string" && menuItem.currency) ||
    (typeof payload.currency === "string" && (payload.currency as string)) ||
    "MXN";

  const outcomeNotes = `Updated ${menuItem.name} selling_price from ${
    oldPrice !== null ? oldPrice : "unknown"
  } to ${newPrice} ${currencyForLog}.`;

  const nowIso = new Date().toISOString();
  const previousStatus = action.status;
  const { data: updatedAction, error: actUpdErr } = await supabase
    .from("agent_actions")
    .update({
      status: "executed",
      executed_at: nowIso,
      executed_by_user_id: userId,
      outcome_notes: outcomeNotes,
    })
    .eq("company_id", companyId)
    .eq("id", actionId)
    .select(ACTION_SELECT)
    .single();
  if (actUpdErr || !updatedAction) {
    // The menu price already changed; surface the partial state so the user
    // (and a developer reading the logs) can intervene. We deliberately do
    // NOT roll back the price update — agent_actions itself is the audit
    // record, and a half-executed action will be visible as "approved with
    // outdated payload" on next reload.
    console.error(
      "[agent-actions/execute] agent_actions update failed AFTER menu price write:",
      actUpdErr?.message
    );
    return NextResponse.json(
      {
        error:
          "Price was updated but the action could not be transitioned to executed. The change is live; please refresh and update the action manually.",
        details: actUpdErr?.message,
        menu_item: {
          id: updatedMenuItem.id,
          name: updatedMenuItem.name,
          old_price: oldPrice,
          new_price: newPrice,
          currency: currencyForLog,
        },
      },
      { status: 500 }
    );
  }

  // ---- 3) Audit event ----
  const eventMetadata: Record<string, unknown> = {
    menu_item_id: menuItemId,
    menu_item_name: menuItem.name,
    old_price: oldPrice,
    new_price: newPrice,
    estimated_cost: estimatedCost,
    target_margin_pct: targetMarginPct,
    expected_margin_after_execution: expectedMarginAfter,
    currency: currencyForLog,
    executed_field: "menu_items.selling_price",
  };
  const { error: evErr } = await supabase.from("agent_action_events").insert({
    company_id: companyId,
    action_id: actionId,
    event_type: "executed",
    user_id: userId,
    note: outcomeNotes,
    previous_status: previousStatus,
    new_status: "executed",
    metadata: eventMetadata,
  });
  if (evErr) {
    console.error("[agent-actions/execute] event insert:", evErr.message);
  }

  return NextResponse.json({
    action: updatedAction,
    menu_item: {
      id: updatedMenuItem.id,
      name: updatedMenuItem.name,
      old_price: oldPrice,
      new_price: newPrice,
      currency: currencyForLog,
    },
    expected_margin_after_execution: expectedMarginAfter,
  });
}
