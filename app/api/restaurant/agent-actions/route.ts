// app/api/restaurant/agent-actions/route.ts
//
// GET /api/restaurant/agent-actions
//   Returns agent_actions rows for the current company, newest first.
//   Optional query params:
//     status            — single status filter
//     recommendation_id — return only actions derived from a specific reco
//     agent_key         — filter by agent

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isAgentActionStatus } from "@/types/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SELECT_COLUMNS =
  "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const recommendationId = url.searchParams.get("recommendation_id");
  const agentKey = url.searchParams.get("agent_key");

  let query = supabase
    .from("agent_actions")
    .select(SELECT_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (statusFilter && isAgentActionStatus(statusFilter)) {
    query = query.eq("status", statusFilter);
  }
  if (recommendationId) query = query.eq("recommendation_id", recommendationId);
  if (agentKey) query = query.eq("agent_key", agentKey);

  const { data, error } = await query;
  if (error) {
    console.error("[agent-actions GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ actions: data ?? [] });
}
