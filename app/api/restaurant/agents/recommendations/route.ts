// app/api/restaurant/agents/recommendations/route.ts
//
// GET /api/restaurant/agents/recommendations
//   Returns agent_recommendations for the company, ordered newest first.
//   Optional query params:
//     status  — filter by a single status value
//     agent_key — filter by agent

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const agentKeyFilter = url.searchParams.get("agent_key");

  let query = supabase
    .from("agent_recommendations")
    .select(
      "id, agent_key, agent_run_id, title, description, severity, recommendation_type, related_entity_type, related_entity_id, suggested_action, status, impact_json, metadata, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (agentKeyFilter) query = query.eq("agent_key", agentKeyFilter);

  const { data, error } = await query;
  if (error) {
    console.error("[agents/recommendations GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ recommendations: data ?? [] });
}
