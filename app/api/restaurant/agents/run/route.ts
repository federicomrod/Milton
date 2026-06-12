// app/api/restaurant/agents/run/route.ts
//
// POST /api/restaurant/agents/run
//   Body: { agent_key: RunnableAgentKey, force_run?: boolean }
//
//   Triggers a manual run of a deterministic agent. The runner reads existing
//   restaurant data, returns structured findings, and this handler persists
//   them into agent_recommendations (with dedupe) and records an agent_runs
//   row for the audit trail.
//
//   No OpenAI, no background work, no autonomous actions.

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  AGENT_RUNNERS,
  isRunnableAgentKey,
  type RunnableAgentKey,
  type RunnerFinding,
} from "@/lib/restaurant/agents/runners";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Dedupe + insert helper
//
// Before inserting a finding, look for an existing open recommendation with
// the same (company_id, agent_key, recommendation_type, related_entity_type,
// related_entity_id, title). If found we refresh its impact_json / metadata /
// agent_run_id instead of creating a duplicate.
// ---------------------------------------------------------------------------

async function upsertFinding(
  supabase: SupabaseClient,
  companyId: string,
  agentRunId: string,
  finding: RunnerFinding
): Promise<"inserted" | "updated" | "skipped"> {
  // Match identical OPEN rows. We intentionally match on `title` so that an
  // updated title (e.g. "margin 12.0%" vs "margin 18.0%") creates a new
  // recommendation — these are genuinely different states the user should see.
  let q = supabase
    .from("agent_recommendations")
    .select("id, impact_json, metadata")
    .eq("company_id", companyId)
    .eq("agent_key", finding.agent_key)
    .eq("recommendation_type", finding.recommendation_type)
    .eq("status", "open")
    .eq("title", finding.title);

  q = finding.related_entity_type
    ? q.eq("related_entity_type", finding.related_entity_type)
    : q.is("related_entity_type", null);
  q = finding.related_entity_id
    ? q.eq("related_entity_id", finding.related_entity_id)
    : q.is("related_entity_id", null);

  const { data: existing, error: lookupErr } = await q.limit(1);
  if (lookupErr) {
    console.error("[agents/run] dedupe lookup:", lookupErr.message);
    // Fall through to insert; duplicate is better than data loss.
  }

  if (existing && existing.length > 0) {
    const id = existing[0].id as string;
    const { error: updateErr } = await supabase
      .from("agent_recommendations")
      .update({
        impact_json: finding.impact_json,
        metadata: finding.metadata,
        severity: finding.severity,
        description: finding.description,
        suggested_action: finding.suggested_action,
        agent_run_id: agentRunId,
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (updateErr) {
      console.error("[agents/run] dedupe update:", updateErr.message);
      return "skipped";
    }
    return "updated";
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("agent_recommendations")
    .insert({
      company_id: companyId,
      agent_key: finding.agent_key,
      agent_run_id: agentRunId,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      recommendation_type: finding.recommendation_type,
      related_entity_type: finding.related_entity_type,
      related_entity_id: finding.related_entity_id,
      suggested_action: finding.suggested_action,
      status: "open",
      impact_json: finding.impact_json,
      metadata: finding.metadata,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[agents/run] insert:", insertErr?.message);
    return "skipped";
  }

  // Audit event (best-effort).
  const { error: evErr } = await supabase
    .from("agent_recommendation_events")
    .insert({
      company_id: companyId,
      recommendation_id: inserted.id,
      event_type: "created",
      metadata: { agent_run_id: agentRunId },
    });
  if (evErr) {
    console.error("[agents/run] event insert:", evErr.message);
  }

  return "inserted";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

  const agentKey = body.agent_key;
  if (!isRunnableAgentKey(agentKey)) {
    return NextResponse.json(
      {
        error:
          "agent_key must be one of: pos_agent, recipe_margin_agent, supplier_agent",
      },
      { status: 400 }
    );
  }
  const forceRun = body.force_run === true;

  // ---- Verify agent_definitions row + availability ----
  const { data: def, error: defErr } = await supabase
    .from("agent_definitions")
    .select("agent_key, is_available, is_coming_soon, default_config, name")
    .eq("agent_key", agentKey)
    .maybeSingle();
  if (defErr) {
    return NextResponse.json(
      { error: "Definition lookup failed", details: defErr.message },
      { status: 500 }
    );
  }
  if (!def) {
    return NextResponse.json(
      { error: "Agent definition not found" },
      { status: 404 }
    );
  }
  if (!def.is_available || def.is_coming_soon) {
    return NextResponse.json(
      { error: "Agent is not available yet" },
      { status: 400 }
    );
  }

  // ---- Resolve or bootstrap config ----
  const { data: existingCfg, error: cfgErr } = await supabase
    .from("agent_configs")
    .select("id, enabled, config")
    .eq("company_id", companyId)
    .eq("agent_key", agentKey)
    .maybeSingle();
  if (cfgErr) {
    return NextResponse.json(
      { error: "Config lookup failed", details: cfgErr.message },
      { status: 500 }
    );
  }

  type CfgRow = {
    id: string;
    enabled: boolean;
    config: Record<string, unknown>;
  };
  let configRow: CfgRow | null = (existingCfg ?? null) as CfgRow | null;
  if (!configRow) {
    const { data: created, error: createErr } = await supabase
      .from("agent_configs")
      .insert({
        company_id: companyId,
        agent_key: agentKey,
        enabled: false,
        run_frequency: "manual",
        config: (def.default_config ?? {}) as Record<string, unknown>,
      })
      .select("id, enabled, config")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: "Could not create agent config", details: createErr?.message },
        { status: 500 }
      );
    }
    configRow = created as CfgRow;
  }

  if (!configRow.enabled && !forceRun) {
    return NextResponse.json(
      {
        error: `${def.name} is disabled. Enable it before running, or pass force_run: true.`,
      },
      { status: 409 }
    );
  }

  // ---- Create the run row ----
  const { data: runInsert, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      company_id: companyId,
      agent_key: agentKey,
      status: "running",
      triggered_by: "manual",
      triggered_by_user_id: userId,
    })
    .select("id, started_at")
    .single();
  if (runErr || !runInsert) {
    return NextResponse.json(
      { error: "Could not start agent run", details: runErr?.message },
      { status: 500 }
    );
  }
  const runId = runInsert.id as string;

  // ---- Execute the runner ----
  const runner = AGENT_RUNNERS[agentKey as RunnableAgentKey];
  try {
    const result = await runner(supabase, companyId, configRow.config ?? {});

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const finding of result.findings) {
      const outcome = await upsertFinding(supabase, companyId, runId, finding);
      if (outcome === "inserted") inserted++;
      else if (outcome === "updated") updated++;
      else skipped++;
    }

    const { error: finishErr } = await supabase
      .from("agent_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        findings_count: result.findings.length,
        summary: result.summary,
        metadata: {
          ...result.metadata,
          inserted,
          updated,
          skipped,
        },
      })
      .eq("id", runId)
      .eq("company_id", companyId);
    if (finishErr) {
      console.error("[agents/run] finalize run:", finishErr.message);
    }

    return NextResponse.json({
      run_id: runId,
      agent_key: agentKey,
      status: "completed",
      findings_count: result.findings.length,
      inserted,
      updated,
      skipped,
      summary: result.summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown runner error";
    console.error("[agents/run] runner failed:", message);
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", runId)
      .eq("company_id", companyId);
    return NextResponse.json(
      { error: "Agent run failed", details: message, run_id: runId },
      { status: 500 }
    );
  }
}
