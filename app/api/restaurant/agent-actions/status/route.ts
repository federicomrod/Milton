// app/api/restaurant/agent-actions/status/route.ts
//
// POST /api/restaurant/agent-actions/status
//   Body: { action_id: string, new_status: AgentActionStatus, note?: string, reopen?: boolean }
//
// Transitions:
//   proposed                     → approved | rejected | cancelled
//   approved                     → assigned | executed | cancelled
//   assigned                     → executed | cancelled
//   executed                     → verified
//   verified                     → (terminal)
//   rejected | cancelled         → proposed (requires reopen=true)
//
// Execution rules:
//   - This endpoint does NOT mutate menu / supplier / ingredient data even
//     when transitioning to `executed`. It only records that the work has
//     been done by the user. Real data-mutating execution will live in a
//     separate endpoint (next milestone).
//   - `executed` is only allowed for actions where isActionExecutable(...)
//     returns true (currently: any non-mutating action OR a
//     suggest_price_change with a valid suggested_price + target identity).
//
// Every status change inserts an agent_action_events row with the
// previous_status / new_status pair.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  AGENT_ACTION_TRANSITIONS,
  isAgentActionStatus,
} from "@/types/agent-actions";
import type {
  AgentAction,
  AgentActionStatus,
  AgentActionEventType,
} from "@/types/agent-actions";
import { isActionExecutable } from "@/lib/restaurant/agents/action-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTION_SELECT =
  "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at";

const STATUS_TO_EVENT: Record<AgentActionStatus, AgentActionEventType> = {
  proposed: "reopened", // only reached via reopen
  approved: "approved",
  rejected: "rejected",
  assigned: "assigned",
  executed: "executed",
  verified: "verified",
  cancelled: "cancelled",
};

function isAllowedTransition(
  current: AgentActionStatus,
  next: AgentActionStatus,
  flags: { reopen: boolean; unassign: boolean }
): { ok: true } | { ok: false; reason: string } {
  if (current === next)
    return { ok: false, reason: "Already in target status" };
  const rules = AGENT_ACTION_TRANSITIONS[current] ?? [];
  for (const rule of rules) {
    if (!rule.to.includes(next)) continue;
    if (rule.requires === "reopen" && !flags.reopen) continue;
    if (rule.requires === "unassign" && !flags.unassign) continue;
    // If a rule explicitly demands a flag we don't have, keep scanning for
    // another (unguarded) rule that might allow the same transition.
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Transition ${current} → ${next} is not allowed.`,
  };
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const actionId = typeof body.action_id === "string" ? body.action_id : "";
  const newStatus = body.new_status;
  if (!actionId) {
    return NextResponse.json(
      { error: "action_id is required" },
      { status: 400 }
    );
  }
  if (!isAgentActionStatus(newStatus)) {
    return NextResponse.json(
      { error: "new_status is required and must be a valid AgentActionStatus" },
      { status: 400 }
    );
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim()
      : null;
  const reopen = body.reopen === true;
  const unassign = body.unassign === true;

  // ---- Load action ----
  const { data: existing, error: loadErr } = await supabase
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
  if (!existing) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }
  const action = existing as AgentAction;

  // ---- Validate transition ----
  const decision = isAllowedTransition(action.status, newStatus, {
    reopen,
    unassign,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: 409 });
  }

  // ---- Execution gate ----
  if (newStatus === "executed" && !isActionExecutable(action)) {
    return NextResponse.json(
      {
        error:
          "This action is not executable yet. For suggest_price_change, the payload must include a target menu_item_id and a suggested_price.",
      },
      { status: 409 }
    );
  }

  // ---- Build update patch ----
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { status: newStatus };
  if (note) {
    patch.outcome_notes = note;
  }
  if (newStatus === "approved") {
    patch.approved_by_user_id = userId;
    patch.approved_at = nowIso;
    // Unassign branch: assigned → approved with unassign=true clears the
    // assignee. We still record the new approval timestamps so the audit
    // trail keeps a clean "approved at X" entry.
    if (unassign && action.status === "assigned") {
      patch.assigned_to_user_id = null;
    }
  } else if (newStatus === "rejected") {
    patch.rejected_by_user_id = userId;
    patch.rejected_at = nowIso;
  } else if (newStatus === "assigned") {
    patch.assigned_to_user_id = userId;
  } else if (newStatus === "executed") {
    patch.executed_by_user_id = userId;
    patch.executed_at = nowIso;
  } else if (newStatus === "verified") {
    patch.verified_by_user_id = userId;
    patch.verified_at = nowIso;
  } else if (newStatus === "cancelled") {
    patch.cancelled_by_user_id = userId;
    patch.cancelled_at = nowIso;
  } else if (newStatus === "proposed" && reopen) {
    // Clear the latest negative timestamps so the lifecycle reads cleanly.
    if (action.status === "rejected") {
      patch.rejected_by_user_id = null;
      patch.rejected_at = null;
    }
    if (action.status === "cancelled") {
      patch.cancelled_by_user_id = null;
      patch.cancelled_at = null;
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from("agent_actions")
    .update(patch)
    .eq("company_id", companyId)
    .eq("id", actionId)
    .select(ACTION_SELECT)
    .single();
  if (updateErr || !updated) {
    console.error("[agent-actions/status] update:", updateErr?.message);
    return NextResponse.json(
      { error: "Update failed", details: updateErr?.message },
      { status: 500 }
    );
  }

  // ---- Audit event ----
  const eventType: AgentActionEventType =
    newStatus === "proposed" && reopen
      ? "reopened"
      : STATUS_TO_EVENT[newStatus];
  const { error: evErr } = await supabase.from("agent_action_events").insert({
    company_id: companyId,
    action_id: actionId,
    event_type: eventType,
    user_id: userId,
    note,
    previous_status: action.status,
    new_status: newStatus,
    metadata: {
      reopen: reopen || undefined,
      unassign: unassign || undefined,
    },
  });
  if (evErr) {
    console.error("[agent-actions/status] event insert:", evErr.message);
  }

  return NextResponse.json({ action: updated });
}
