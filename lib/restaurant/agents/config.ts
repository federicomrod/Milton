// lib/restaurant/agents/config.ts
//
// Runtime constants for the agent coordination model. Kept separate from
// types/agents.ts so server routes, server components, and client code
// can import the lists at runtime (the types file is type-only).
//
// IMPORTANT: keep these arrays in lockstep with the seed data in
// supabase/migrations/008_agent_coordination_foundation.sql. The migration
// is the source of truth; this file is a typed mirror.

import type {
  AgentCategory,
  AgentKey,
  AgentRecommendationEventType,
  AgentRecommendationStatus,
  AgentRunFrequency,
  AgentRunStatus,
  AgentRunTrigger,
  AgentSeverity,
} from "@/types/agents";

// ---------------------------------------------------------------------------
// Supported agent keys
// ---------------------------------------------------------------------------

export const AGENT_KEYS: readonly AgentKey[] = [
  "pos_agent",
  "recipe_margin_agent",
  "supplier_agent",
  "invoice_agent",
  "inventory_agent",
  "finance_agent",
  "menu_agent",
] as const;

/** Keys for agents that are live (i.e. can be enabled today). The others
 *  appear in the catalog as "coming soon" and are not configurable. */
export const LIVE_AGENT_KEYS: readonly AgentKey[] = [
  "pos_agent",
  "recipe_margin_agent",
  "supplier_agent",
] as const;

export const COMING_SOON_AGENT_KEYS: readonly AgentKey[] = [
  "invoice_agent",
  "inventory_agent",
  "finance_agent",
  "menu_agent",
] as const;

// ---------------------------------------------------------------------------
// Enums (mirror SQL CHECK constraints)
// ---------------------------------------------------------------------------

export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  "sales",
  "margin",
  "supplier",
  "invoice",
  "inventory",
  "finance",
  "menu",
] as const;

export const AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export const AGENT_RUN_TRIGGERS: readonly AgentRunTrigger[] = [
  "manual",
  "schedule",
  "system",
  "api",
] as const;

export const AGENT_RUN_FREQUENCIES: readonly AgentRunFrequency[] = [
  "manual",
  "daily",
  "weekly",
] as const;

export const AGENT_SEVERITIES: readonly AgentSeverity[] = [
  "info",
  "warning",
  "critical",
] as const;

export const AGENT_RECOMMENDATION_STATUSES: readonly AgentRecommendationStatus[] =
  ["open", "approved", "dismissed", "resolved", "snoozed"] as const;

export const AGENT_RECOMMENDATION_EVENT_TYPES: readonly AgentRecommendationEventType[] =
  [
    "created",
    "approved",
    "dismissed",
    "resolved",
    "snoozed",
    "reopened",
    "note_added",
  ] as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_SEVERITY: AgentSeverity = "info";
export const DEFAULT_RECOMMENDATION_STATUS: AgentRecommendationStatus = "open";
export const DEFAULT_RUN_STATUS: AgentRunStatus = "queued";
export const DEFAULT_RUN_TRIGGER: AgentRunTrigger = "manual";
export const DEFAULT_RUN_FREQUENCY: AgentRunFrequency = "manual";

// ---------------------------------------------------------------------------
// Guards (cheap runtime validators for API inputs)
// ---------------------------------------------------------------------------

export function isAgentKey(v: unknown): v is AgentKey {
  return typeof v === "string" && (AGENT_KEYS as readonly string[]).includes(v);
}

export function isAgentSeverity(v: unknown): v is AgentSeverity {
  return (
    typeof v === "string" && (AGENT_SEVERITIES as readonly string[]).includes(v)
  );
}

export function isAgentRecommendationStatus(
  v: unknown
): v is AgentRecommendationStatus {
  return (
    typeof v === "string" &&
    (AGENT_RECOMMENDATION_STATUSES as readonly string[]).includes(v)
  );
}

export function isAgentRunStatus(v: unknown): v is AgentRunStatus {
  return (
    typeof v === "string" &&
    (AGENT_RUN_STATUSES as readonly string[]).includes(v)
  );
}

export function isAgentRunFrequency(v: unknown): v is AgentRunFrequency {
  return (
    typeof v === "string" &&
    (AGENT_RUN_FREQUENCIES as readonly string[]).includes(v)
  );
}
