// types/agents.ts
//
// Shared types for the restaurant agent coordination model.
// Mirrors the schema defined in
// supabase/migrations/008_agent_coordination_foundation.sql.
//
// All `agent_key` values must match a row in `agent_definitions`. The
// runtime allowed keys live in lib/restaurant/agents/config.ts so they
// can be imported from server and client code without dragging types in.

// ---------------------------------------------------------------------------
// Enums (string unions kept in sync with the SQL CHECK constraints)
// ---------------------------------------------------------------------------

export type AgentKey =
  | "pos_agent"
  | "recipe_margin_agent"
  | "supplier_agent"
  | "invoice_agent"
  | "inventory_agent"
  | "finance_agent"
  | "menu_agent";

export type AgentCategory =
  | "sales"
  | "margin"
  | "supplier"
  | "invoice"
  | "inventory"
  | "finance"
  | "menu";

export type AgentRunFrequency = "manual" | "daily" | "weekly";

export type AgentRunStatus = "queued" | "running" | "completed" | "failed";

export type AgentRunTrigger = "manual" | "schedule" | "system" | "api";

export type AgentSeverity = "info" | "warning" | "critical";

export type AgentRecommendationStatus =
  | "open"
  | "approved"
  | "dismissed"
  | "resolved"
  | "snoozed";

export type AgentRecommendationEventType =
  | "created"
  | "approved"
  | "dismissed"
  | "resolved"
  | "snoozed"
  | "reopened"
  | "note_added";

/**
 * Reusable taxonomy of recommendation types. Kept as an open string union
 * (string | known literals) so agents can introduce new types without a
 * schema migration; the known list documents what the seeded agents
 * produce today.
 */
export type AgentRecommendationType =
  | "missing_recipe"
  | "low_margin"
  | "high_food_cost"
  | "unit_mismatch"
  | "price_increase"
  | "supplier_concentration"
  | "missing_supplier_metadata"
  | "revenue_drop"
  | "channel_shift"
  | "low_volume_item"
  | (string & {});

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  agent_key: AgentKey;
  name: string;
  description: string;
  category: AgentCategory;
  is_available: boolean;
  is_coming_soon: boolean;
  default_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentConfig {
  id: string;
  company_id: string;
  agent_key: AgentKey;
  enabled: boolean;
  run_frequency: AgentRunFrequency;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  company_id: string;
  agent_key: AgentKey;
  status: AgentRunStatus;
  triggered_by: AgentRunTrigger;
  triggered_by_user_id: string | null;
  started_at: string;
  finished_at: string | null;
  findings_count: number;
  summary: string | null;
  metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
}

export interface AgentRecommendation {
  id: string;
  company_id: string;
  agent_key: AgentKey;
  agent_run_id: string | null;
  title: string;
  description: string;
  severity: AgentSeverity;
  recommendation_type: AgentRecommendationType;
  related_entity_type: string | null;
  related_entity_id: string | null;
  suggested_action: string | null;
  status: AgentRecommendationStatus;
  impact_json: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentRecommendationEvent {
  id: string;
  company_id: string;
  recommendation_id: string;
  event_type: AgentRecommendationEventType;
  user_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
