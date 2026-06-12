// app/api/restaurant/agent-actions/proposals/route.ts
//
// GET /api/restaurant/agent-actions/proposals?recommendation_id=...
//   Returns the deterministic proposals for a recommendation WITHOUT
//   persisting them. The UI uses this to show the user what would be created
//   before they press "Create action".

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { proposeActionsForRecommendation } from "@/lib/restaurant/agents/action-proposals";
import type { AgentRecommendation } from "@/types/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const url = new URL(req.url);
  const recommendationId = url.searchParams.get("recommendation_id");
  if (!recommendationId) {
    return NextResponse.json(
      { error: "recommendation_id is required" },
      { status: 400 }
    );
  }

  const { data: rec, error } = await supabase
    .from("agent_recommendations")
    .select(
      "id, company_id, agent_key, agent_run_id, title, description, severity, recommendation_type, related_entity_type, related_entity_id, suggested_action, status, impact_json, metadata, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .eq("id", recommendationId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "Recommendation lookup failed", details: error.message },
      { status: 500 }
    );
  }
  if (!rec) {
    return NextResponse.json(
      { error: "Recommendation not found" },
      { status: 404 }
    );
  }

  // Also check whether existing actions already came out of this recommendation,
  // so the UI can show "1 action already exists" instead of offering a dupe.
  const { data: existing } = await supabase
    .from("agent_actions")
    .select("id, action_type, status, title, related_entity_id, created_at")
    .eq("company_id", companyId)
    .eq("recommendation_id", recommendationId)
    .order("created_at", { ascending: false })
    .limit(20);

  const proposals = proposeActionsForRecommendation(rec as AgentRecommendation);
  return NextResponse.json({
    proposals,
    existing_actions: existing ?? [],
  });
}
