// app/api/restaurant/agents/runs/route.ts
//
// GET /api/restaurant/agents/runs
//   Returns agent_runs for the company, ordered newest first.
//   Optional query params:
//     agent_key — filter by a specific agent
//     status    — filter by run status

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const url = new URL(req.url);
  const agentKeyFilter = url.searchParams.get("agent_key");
  const statusFilter = url.searchParams.get("status");

  let query = supabase
    .from("agent_runs")
    .select(
      "id, agent_key, status, triggered_by, triggered_by_user_id, started_at, finished_at, findings_count, summary, error_message, metadata, created_at"
    )
    .eq("company_id", companyId)
    .order("started_at", { ascending: false })
    .limit(100);

  if (agentKeyFilter) query = query.eq("agent_key", agentKeyFilter);
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) {
    console.error("[agents/runs GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ runs: data ?? [] });
}
