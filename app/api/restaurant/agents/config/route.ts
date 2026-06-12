// app/api/restaurant/agents/config/route.ts
//
// GET  /api/restaurant/agents/config
//   Returns agent_definitions joined with agent_configs for the company.
//   Fields from agent_definitions are stable; config/enabled/run_frequency
//   come from agent_configs (null when no row exists yet for that agent).
//
// POST /api/restaurant/agents/config
//   Body: { agent_key, enabled?, run_frequency?, config? }
//   Upserts the company's agent_config row for the given agent_key.
//   Returns the full upserted row.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  isAgentKey,
  isAgentRunFrequency,
} from "@/lib/restaurant/agents/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const [defsRes, cfgRes] = await Promise.all([
    supabase
      .from("agent_definitions")
      .select(
        "id, agent_key, name, description, category, is_available, is_coming_soon, default_config, created_at, updated_at"
      )
      .order("category")
      .order("name"),
    supabase
      .from("agent_configs")
      .select(
        "id, agent_key, enabled, run_frequency, config, created_at, updated_at"
      )
      .eq("company_id", companyId),
  ]);

  if (defsRes.error) {
    console.error(
      "[agents/config GET] agent_definitions:",
      defsRes.error.message
    );
    return NextResponse.json(
      {
        error: "Could not load agent definitions",
        details: defsRes.error.message,
      },
      { status: 500 }
    );
  }

  const cfgByKey = new Map(
    ((cfgRes.data ?? []) as { agent_key: string }[]).map((c) => [
      c.agent_key,
      c,
    ])
  );

  const agents = (defsRes.data ?? []).map((def) => ({
    ...def,
    config: cfgByKey.get(def.agent_key) ?? null,
  }));

  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const agentKey = typeof body.agent_key === "string" ? body.agent_key : "";
  if (!isAgentKey(agentKey)) {
    return NextResponse.json(
      { error: "Invalid or missing agent_key" },
      { status: 400 }
    );
  }

  // Verify agent is available (not coming_soon).
  const { data: def, error: defErr } = await supabase
    .from("agent_definitions")
    .select("is_available, is_coming_soon, default_config")
    .eq("agent_key", agentKey)
    .maybeSingle();

  if (defErr || !def) {
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

  const patch: Record<string, unknown> = {};

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }
  if (typeof body.run_frequency === "string") {
    if (!isAgentRunFrequency(body.run_frequency)) {
      return NextResponse.json(
        { error: "run_frequency must be one of: manual, daily, weekly" },
        { status: 400 }
      );
    }
    patch.run_frequency = body.run_frequency;
  }
  if (
    body.config !== undefined &&
    typeof body.config === "object" &&
    body.config !== null
  ) {
    patch.config = body.config;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Upsert. On conflict (company_id, agent_key) we merge only the supplied fields.
  const { data, error } = await supabase
    .from("agent_configs")
    .upsert(
      {
        company_id: companyId,
        agent_key: agentKey,
        // Defaults used on first insert; only the supplied patch fields will
        // override on conflict (handled by the explicit onConflict below).
        enabled: patch.enabled ?? false,
        run_frequency: patch.run_frequency ?? "manual",
        config: patch.config ?? (def.default_config as Record<string, unknown>),
        ...patch,
      },
      { onConflict: "company_id,agent_key" }
    )
    .select(
      "id, agent_key, enabled, run_frequency, config, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    console.error("[agents/config POST] upsert:", error?.message);
    return NextResponse.json(
      { error: "Upsert failed", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ config: data });
}
