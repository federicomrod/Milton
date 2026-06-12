// app/api/restaurant/ask-milton/create-action/route.ts
//
// POST /api/restaurant/ask-milton/create-action
//
// Creates an agent_action row from an Ask Milton suggested-action chip.
// The chip is a proposal only — nothing is approved or executed here.
//
// Safety:
//   - Requires authenticated user.
//   - Validates action_type is an allowed AgentActionType.
//   - Validates agent_key if present.
//   - Validates related_entity_id belongs to the caller's company.
//   - Prevents duplicates: if an open (proposed/approved/assigned) action
//     already exists for the same (company, action_type,
//     related_entity_type, related_entity_id), returns 409.
//   - Only writes to agent_actions and agent_action_events.
//   - Does NOT approve, execute, or mutate any other table.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  AGENT_ACTION_TYPES,
  isAgentActionType,
  isAgentActionPriority,
  type AgentAction,
  type AgentActionStatus,
} from "@/types/agent-actions";
import { AGENT_KEYS } from "@/lib/restaurant/agents/config";
import type { SuggestedAction } from "@/lib/restaurant/ask-milton-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_STATUSES: readonly AgentActionStatus[] = [
  "proposed",
  "approved",
  "assigned",
];

const ACTION_SELECT =
  "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at";

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

  const suggestedAction = body.suggested_action as SuggestedAction | null;
  if (!suggestedAction || typeof suggestedAction !== "object") {
    return NextResponse.json(
      { error: "suggested_action is required" },
      { status: 400 }
    );
  }

  // ---- Validate creates_agent_action ----
  if (!suggestedAction.creates_agent_action) {
    return NextResponse.json(
      {
        error: "This action is navigation-only; no agent_action row is created",
      },
      { status: 400 }
    );
  }

  // ---- Validate action_type ----
  if (!isAgentActionType(suggestedAction.action_type)) {
    return NextResponse.json(
      {
        error: `Invalid action_type "${suggestedAction.action_type}". Allowed: ${AGENT_ACTION_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // ---- Validate agent_key (if present) ----
  if (
    suggestedAction.agent_key !== null &&
    suggestedAction.agent_key !== undefined &&
    !(AGENT_KEYS as readonly string[]).includes(suggestedAction.agent_key)
  ) {
    return NextResponse.json(
      { error: `Unknown agent_key "${suggestedAction.agent_key}"` },
      { status: 400 }
    );
  }

  // ---- Validate priority ----
  if (
    suggestedAction.priority &&
    !isAgentActionPriority(suggestedAction.priority)
  ) {
    return NextResponse.json(
      { error: `Invalid priority "${suggestedAction.priority}"` },
      { status: 400 }
    );
  }

  // ---- Validate label (used as title) ----
  const label =
    typeof suggestedAction.label === "string" && suggestedAction.label.trim()
      ? suggestedAction.label.trim()
      : null;
  if (!label) {
    return NextResponse.json(
      { error: "suggested_action.label is required" },
      { status: 400 }
    );
  }

  // ---- Validate related entity belongs to this company ----
  const entityType = suggestedAction.related_entity_type ?? null;
  const entityId = suggestedAction.related_entity_id ?? null;

  if (entityType && entityId) {
    let entityError: string | null = null;

    if (entityType === "menu_item") {
      const { data: item, error: itemErr } = await supabase
        .from("menu_items")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", entityId)
        .maybeSingle();
      if (itemErr) {
        console.error(
          "[ask-milton/create-action] menu_item lookup:",
          itemErr.message
        );
        entityError = "Could not validate menu item";
      } else if (!item) {
        entityError = "Menu item not found or not in your company";
      }
    } else if (entityType === "supplier") {
      const { data: supplier, error: supplierErr } = await supabase
        .from("suppliers")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", entityId)
        .maybeSingle();
      if (supplierErr) {
        console.error(
          "[ask-milton/create-action] supplier lookup:",
          supplierErr.message
        );
        entityError = "Could not validate supplier";
      } else if (!supplier) {
        entityError = "Supplier not found or not in your company";
      }
    }

    if (entityError) {
      return NextResponse.json({ error: entityError }, { status: 400 });
    }
  }

  // ---- Duplicate prevention ----
  // An open action with the same (action_type, related_entity_type, related_entity_id)
  // for this company already covers this proposal.
  let dedupeQ = supabase
    .from("agent_actions")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("action_type", suggestedAction.action_type)
    .in("status", OPEN_STATUSES as readonly string[]);

  if (entityType) {
    dedupeQ = dedupeQ.eq("related_entity_type", entityType);
  } else {
    dedupeQ = dedupeQ.is("related_entity_type", null);
  }

  if (entityId) {
    dedupeQ = dedupeQ.eq("related_entity_id", entityId);
  } else {
    dedupeQ = dedupeQ.is("related_entity_id", null);
  }

  const { data: existing, error: dedupeErr } = await dedupeQ.limit(1);
  if (dedupeErr) {
    console.error(
      "[ask-milton/create-action] dedupe lookup:",
      dedupeErr.message
    );
  }
  if (existing && existing.length > 0) {
    return NextResponse.json(
      {
        error: "duplicate",
        message: `An open action of type "${suggestedAction.action_type}" already exists for this item.`,
        existing_action_id: (existing[0] as { id: string }).id,
      },
      { status: 409 }
    );
  }

  // ---- Insert agent_action ----
  const insertRow = {
    company_id: companyId,
    recommendation_id: null,
    agent_key: suggestedAction.agent_key ?? null,
    action_type: suggestedAction.action_type,
    title: label,
    description: `Proposed via Ask Milton`,
    status: "proposed" as AgentActionStatus,
    priority: suggestedAction.priority ?? "medium",
    related_entity_type: entityType,
    related_entity_id: entityId,
    payload_json: suggestedAction.payload_json ?? {},
    impact_json: suggestedAction.impact_json ?? {},
    proposed_by: "user",
    created_by_user_id: userId,
  };

  const { data: row, error: insertErr } = await supabase
    .from("agent_actions")
    .insert(insertRow)
    .select(ACTION_SELECT)
    .single();

  if (insertErr || !row) {
    console.error("[ask-milton/create-action] insert:", insertErr?.message);
    return NextResponse.json(
      {
        error: "Could not create action",
        details: insertErr?.message ?? "Insert failed",
      },
      { status: 500 }
    );
  }

  // ---- Audit event ----
  const { error: evErr } = await supabase.from("agent_action_events").insert({
    company_id: companyId,
    action_id: (row as AgentAction).id,
    event_type: "created",
    user_id: userId,
    previous_status: null,
    new_status: "proposed",
    metadata: { source: "ask_milton" },
  });
  if (evErr) {
    console.error("[ask-milton/create-action] event insert:", evErr.message);
  }

  return NextResponse.json({ action: row as AgentAction }, { status: 201 });
}
