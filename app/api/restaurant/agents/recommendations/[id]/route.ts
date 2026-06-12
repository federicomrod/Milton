// app/api/restaurant/agents/recommendations/[id]/route.ts
//
// PATCH /api/restaurant/agents/recommendations/:id
//   Body: { status: AgentRecommendationStatus, note?: string }
//   Updates recommendation status and inserts an audit event.
//
//   Allowed transitions:
//     open        → approved | dismissed | snoozed
//     approved    → resolved | dismissed
//     dismissed   → reopened (status becomes 'open')
//     snoozed     → open | approved | dismissed
//     resolved    → reopened (status becomes 'open')

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isAgentRecommendationStatus } from "@/lib/restaurant/agents/config";
import type { AgentRecommendationEventType } from "@/types/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Map the requested new status → the event_type to record.
const STATUS_TO_EVENT: Record<string, AgentRecommendationEventType> = {
  approved: "approved",
  dismissed: "dismissed",
  resolved: "resolved",
  snoozed: "snoozed",
  open: "reopened",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const newStatus = typeof body.status === "string" ? body.status : null;
  if (!newStatus || !isAgentRecommendationStatus(newStatus)) {
    return NextResponse.json(
      {
        error:
          "status must be one of: open, approved, dismissed, resolved, snoozed",
      },
      { status: 400 }
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.trim()
      : null;

  // Confirm the recommendation belongs to this company before updating.
  const { data: existing, error: fetchErr } = await supabase
    .from("agent_recommendations")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json(
      { error: "Read failed", details: fetchErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Recommendation not found" },
      { status: 404 }
    );
  }

  // Update status.
  const { data: updated, error: updateErr } = await supabase
    .from("agent_recommendations")
    .update({ status: newStatus })
    .eq("company_id", companyId)
    .eq("id", id)
    .select("id, status, updated_at")
    .single();

  if (updateErr || !updated) {
    console.error("[agents/recommendations PATCH] update:", updateErr?.message);
    return NextResponse.json(
      { error: "Update failed", details: updateErr?.message },
      { status: 500 }
    );
  }

  // Insert audit event (best-effort — don't fail the request if it errors).
  const eventType = STATUS_TO_EVENT[newStatus] ?? "note_added";
  const { error: eventErr } = await supabase
    .from("agent_recommendation_events")
    .insert({
      company_id: companyId,
      recommendation_id: id,
      event_type: eventType,
      user_id: auth.userId ?? null,
      note,
    });
  if (eventErr) {
    console.error(
      "[agents/recommendations PATCH] event insert:",
      eventErr.message
    );
  }

  return NextResponse.json({ recommendation: updated });
}
