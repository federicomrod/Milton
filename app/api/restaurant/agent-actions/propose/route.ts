// app/api/restaurant/agent-actions/propose/route.ts
//
// POST /api/restaurant/agent-actions/propose
//   Body: { recommendation_id: string, create?: boolean }
//
// Behaviour:
//   - Resolves the recommendation under the caller's company.
//   - Generates deterministic action proposals via proposeActionsForRecommendation.
//   - If create === true:
//       * Inserts each proposal into agent_actions with status='proposed'.
//       * Skips inserts that would duplicate an OPEN (proposed/approved/assigned)
//         action for the same (recommendation_id, action_type, related_entity_id).
//       * Records an `agent_action_events.created` row for each inserted action.
//   - Otherwise returns the proposals as drafts (preview).

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  proposeActionsForRecommendation,
  type AgentActionProposal,
} from "@/lib/restaurant/agents/action-proposals";
import type { AgentRecommendation } from "@/types/agents";
import type { AgentAction, AgentActionStatus } from "@/types/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Statuses that mean "this action is still alive". When one already exists
// for the same recommendation + action_type + related_entity, the proposer
// won't create a new duplicate alongside it.
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

  const recommendationId =
    typeof body.recommendation_id === "string" ? body.recommendation_id : "";
  const shouldCreate = body.create === true;
  if (!recommendationId) {
    return NextResponse.json(
      { error: "recommendation_id is required" },
      { status: 400 }
    );
  }

  // ---- Load the recommendation (company-scoped) ----
  const { data: rec, error: recErr } = await supabase
    .from("agent_recommendations")
    .select(
      "id, company_id, agent_key, agent_run_id, title, description, severity, recommendation_type, related_entity_type, related_entity_id, suggested_action, status, impact_json, metadata, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .eq("id", recommendationId)
    .maybeSingle();
  if (recErr) {
    return NextResponse.json(
      { error: "Recommendation lookup failed", details: recErr.message },
      { status: 500 }
    );
  }
  if (!rec) {
    return NextResponse.json(
      { error: "Recommendation not found" },
      { status: 404 }
    );
  }

  const proposals = proposeActionsForRecommendation(rec as AgentRecommendation);

  if (!shouldCreate) {
    return NextResponse.json({ proposals, created: false });
  }

  // ---- Persist proposals ----
  const created: AgentAction[] = [];
  const skipped: { proposal: AgentActionProposal; reason: string }[] = [];

  for (const proposal of proposals) {
    // Dedupe: skip if there is an OPEN action with same recommendation +
    // action_type + related_entity_id.
    let dedupeQ = supabase
      .from("agent_actions")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("recommendation_id", recommendationId)
      .eq("action_type", proposal.action_type)
      .in("status", OPEN_STATUSES as readonly string[]);
    dedupeQ = proposal.related_entity_id
      ? dedupeQ.eq("related_entity_id", proposal.related_entity_id)
      : dedupeQ.is("related_entity_id", null);
    const { data: existing, error: dedupeErr } = await dedupeQ.limit(1);
    if (dedupeErr) {
      console.error(
        "[agent-actions/propose] dedupe lookup:",
        dedupeErr.message
      );
    }
    if (existing && existing.length > 0) {
      skipped.push({
        proposal,
        reason: `An open action of type "${proposal.action_type}" already exists for this recommendation.`,
      });
      continue;
    }

    const insertRow = {
      company_id: companyId,
      recommendation_id: recommendationId,
      agent_key: rec.agent_key,
      action_type: proposal.action_type,
      title: proposal.title,
      description: proposal.description,
      status: "proposed" as AgentActionStatus,
      priority: proposal.priority,
      related_entity_type: proposal.related_entity_type,
      related_entity_id: proposal.related_entity_id,
      payload_json: proposal.payload_json ?? {},
      impact_json: proposal.impact_json ?? {},
      proposed_by: "agent",
      created_by_user_id: userId,
    };

    const { data: row, error: insertErr } = await supabase
      .from("agent_actions")
      .insert(insertRow)
      .select(ACTION_SELECT)
      .single();
    if (insertErr || !row) {
      console.error("[agent-actions/propose] insert:", insertErr?.message);
      skipped.push({
        proposal,
        reason: insertErr?.message ?? "Insert failed",
      });
      continue;
    }
    created.push(row as AgentAction);

    // Audit event (best-effort).
    const { error: evErr } = await supabase.from("agent_action_events").insert({
      company_id: companyId,
      action_id: (row as AgentAction).id,
      event_type: "created",
      user_id: userId,
      previous_status: null,
      new_status: "proposed",
      metadata: { recommendation_id: recommendationId },
    });
    if (evErr) {
      console.error("[agent-actions/propose] event insert:", evErr.message);
    }
  }

  return NextResponse.json({
    proposals,
    created: true,
    actions: created,
    skipped,
  });
}
