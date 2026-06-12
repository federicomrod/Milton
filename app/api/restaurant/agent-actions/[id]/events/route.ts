// app/api/restaurant/agent-actions/[id]/events/route.ts
//
// GET /api/restaurant/agent-actions/:id/events
//   Returns the audit trail for an action, oldest first.
//   The action itself is also returned for convenience (so the client doesn't
//   need a second round-trip when expanding a card).

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTION_SELECT =
  "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const [actionRes, eventsRes] = await Promise.all([
    supabase
      .from("agent_actions")
      .select(ACTION_SELECT)
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("agent_action_events")
      .select(
        "id, company_id, action_id, event_type, user_id, note, previous_status, new_status, metadata, created_at"
      )
      .eq("company_id", companyId)
      .eq("action_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  if (actionRes.error) {
    return NextResponse.json(
      { error: "Action lookup failed", details: actionRes.error.message },
      { status: 500 }
    );
  }
  if (!actionRes.data) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }
  if (eventsRes.error) {
    console.error(
      "[agent-actions/:id/events] events read:",
      eventsRes.error.message
    );
  }

  return NextResponse.json({
    action: actionRes.data,
    events: eventsRes.data ?? [],
  });
}
