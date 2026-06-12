// app/dashboard/restaurant/agents/page.tsx
//
// Server Component: loads agents, configs, recommendations, and run history
// for the current company, then hands everything to the client
// AgentControlCenter component.

import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  AgentControlCenter,
  type AgentWithConfig,
} from "@/components/restaurant/AgentControlCenter";
import type { AgentRecommendation, AgentRun } from "@/types/agents";
import type { AgentAction } from "@/types/agent-actions";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const companyId = user
    ? await resolveCompanyIdForUser(supabase, user.id)
    : null;

  // ------------------------------------------------------------------
  // Fetch all four datasets in parallel. Each one degrades to empty on
  // error so a missing table (migration not yet run) doesn't crash the page.
  // ------------------------------------------------------------------
  const [defsRes, cfgRes, recoRes, runsRes, actionsRes] = await Promise.all([
    supabase
      .from("agent_definitions")
      .select(
        "id, agent_key, name, description, category, is_available, is_coming_soon, default_config, created_at, updated_at"
      )
      .order("category")
      .order("name"),
    companyId
      ? supabase
          .from("agent_configs")
          .select(
            "id, agent_key, enabled, run_frequency, config, created_at, updated_at"
          )
          .eq("company_id", companyId)
      : Promise.resolve({ data: [], error: null }),
    companyId
      ? supabase
          .from("agent_recommendations")
          .select(
            "id, agent_key, agent_run_id, title, description, severity, recommendation_type, related_entity_type, related_entity_id, suggested_action, status, impact_json, metadata, created_at, updated_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    companyId
      ? supabase
          .from("agent_runs")
          .select(
            "id, agent_key, status, triggered_by, triggered_by_user_id, started_at, finished_at, findings_count, summary, error_message, metadata, created_at"
          )
          .eq("company_id", companyId)
          .order("started_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    companyId
      ? supabase
          .from("agent_actions")
          .select(
            "id, company_id, recommendation_id, agent_key, action_type, title, description, status, priority, related_entity_type, related_entity_id, payload_json, impact_json, assigned_to_user_id, due_date, proposed_by, created_by_user_id, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, executed_by_user_id, executed_at, verified_by_user_id, verified_at, cancelled_by_user_id, cancelled_at, outcome_notes, created_at, updated_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (defsRes.error)
    console.error("[agents page] agent_definitions:", defsRes.error.message);
  if (cfgRes.error)
    console.error("[agents page] agent_configs:", cfgRes.error.message);
  if (recoRes.error)
    console.error(
      "[agents page] agent_recommendations:",
      recoRes.error.message
    );
  if (runsRes.error)
    console.error("[agents page] agent_runs:", runsRes.error.message);
  if (actionsRes.error)
    console.error("[agents page] agent_actions:", actionsRes.error.message);

  // Build combined agent+config list.
  type RawDef = {
    id: string;
    agent_key: string;
    name: string;
    description: string;
    category: string;
    is_available: boolean;
    is_coming_soon: boolean;
    default_config: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  type RawCfg = {
    id: string;
    agent_key: string;
    enabled: boolean;
    run_frequency: string;
    config: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };

  const cfgByKey = new Map(
    ((cfgRes.data ?? []) as RawCfg[]).map((c) => [c.agent_key, c])
  );

  const agents: AgentWithConfig[] = ((defsRes.data ?? []) as RawDef[]).map(
    (def) => ({
      ...(def as unknown as AgentWithConfig),
      config:
        (cfgByKey.get(def.agent_key) as AgentWithConfig["config"]) ?? null,
    })
  );

  const recommendations = (recoRes.data ?? []) as AgentRecommendation[];
  const runs = (runsRes.data ?? []) as AgentRun[];
  const actions = (actionsRes.data ?? []) as AgentAction[];

  return (
    <AgentControlCenter
      initialAgents={agents}
      initialRecommendations={recommendations}
      initialRuns={runs}
      initialActions={actions}
      currentUserId={user?.id ?? null}
    />
  );
}
