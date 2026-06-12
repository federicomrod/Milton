// types/agent-actions.ts
//
// Shared types for the Agent Action Workflow. Mirrors the schema defined in
// supabase/migrations/009_agent_action_workflow.sql.
//
// Decision history is product-critical: actions are NEVER deleted from the
// UI — rejected / cancelled / executed / verified rows stay queryable so
// future learning loops can reason about them.

import type { AgentKey } from "@/types/agents";

// ---------------------------------------------------------------------------
// Enums (mirror SQL CHECK constraints)
// ---------------------------------------------------------------------------

export type AgentActionType =
  | "open_related_record"
  | "create_setup_task"
  | "suggest_price_change"
  | "draft_supplier_message"
  | "review_supplier"
  | "review_recipe"
  | "mark_reviewed";

export type AgentActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "assigned"
  | "executed"
  | "verified"
  | "cancelled";

export type AgentActionPriority = "low" | "medium" | "high" | "critical";

export type AgentActionProposedBy = "agent" | "user" | "system";

export type AgentActionEventType =
  | "created"
  | "approved"
  | "rejected"
  | "assigned"
  | "executed"
  | "verified"
  | "cancelled"
  | "reopened"
  | "note_added"
  | "payload_updated";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface AgentAction {
  id: string;
  company_id: string;
  recommendation_id: string | null;
  agent_key: AgentKey;
  action_type: AgentActionType;
  title: string;
  description: string | null;
  status: AgentActionStatus;
  priority: AgentActionPriority;
  related_entity_type: string | null;
  related_entity_id: string | null;
  payload_json: Record<string, unknown>;
  impact_json: Record<string, unknown>;
  assigned_to_user_id: string | null;
  due_date: string | null;
  proposed_by: AgentActionProposedBy;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejected_by_user_id: string | null;
  rejected_at: string | null;
  executed_by_user_id: string | null;
  executed_at: string | null;
  verified_by_user_id: string | null;
  verified_at: string | null;
  cancelled_by_user_id: string | null;
  cancelled_at: string | null;
  outcome_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentActionEvent {
  id: string;
  company_id: string;
  action_id: string;
  event_type: AgentActionEventType;
  user_id: string | null;
  note: string | null;
  previous_status: AgentActionStatus | null;
  new_status: AgentActionStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Runtime lists (mirror the SQL CHECK arrays)
// ---------------------------------------------------------------------------

export const AGENT_ACTION_TYPES: readonly AgentActionType[] = [
  "open_related_record",
  "create_setup_task",
  "suggest_price_change",
  "draft_supplier_message",
  "review_supplier",
  "review_recipe",
  "mark_reviewed",
] as const;

export const AGENT_ACTION_STATUSES: readonly AgentActionStatus[] = [
  "proposed",
  "approved",
  "rejected",
  "assigned",
  "executed",
  "verified",
  "cancelled",
] as const;

export const AGENT_ACTION_PRIORITIES: readonly AgentActionPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const AGENT_ACTION_EVENT_TYPES: readonly AgentActionEventType[] = [
  "created",
  "approved",
  "rejected",
  "assigned",
  "executed",
  "verified",
  "cancelled",
  "reopened",
  "note_added",
  "payload_updated",
] as const;

// ---------------------------------------------------------------------------
// Cheap runtime guards (for API inputs)
// ---------------------------------------------------------------------------

export function isAgentActionType(v: unknown): v is AgentActionType {
  return (
    typeof v === "string" &&
    (AGENT_ACTION_TYPES as readonly string[]).includes(v)
  );
}

export function isAgentActionStatus(v: unknown): v is AgentActionStatus {
  return (
    typeof v === "string" &&
    (AGENT_ACTION_STATUSES as readonly string[]).includes(v)
  );
}

export function isAgentActionPriority(v: unknown): v is AgentActionPriority {
  return (
    typeof v === "string" &&
    (AGENT_ACTION_PRIORITIES as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Transition table (single source of truth for the API + UI gating)
// ---------------------------------------------------------------------------

export interface TransitionRule {
  /** Allowed target statuses from `from`. */
  to: readonly AgentActionStatus[];
  /** Optional condition flag — currently `reopen` (rejected/cancelled → proposed)
   *  and `unassign` (assigned → approved). */
  requires?: "reopen" | "unassign";
}

export const AGENT_ACTION_TRANSITIONS: Record<
  AgentActionStatus,
  TransitionRule[]
> = {
  proposed: [{ to: ["approved", "rejected", "cancelled"] }],
  approved: [{ to: ["assigned", "executed", "cancelled"] }],
  assigned: [
    { to: ["executed", "cancelled"] },
    // Unassign: drop the user and go back to "approved" so the action stays
    // in the actionable pool without a stale assignee.
    { to: ["approved"], requires: "unassign" },
  ],
  executed: [{ to: ["verified"] }],
  verified: [],
  rejected: [{ to: ["proposed"], requires: "reopen" }],
  cancelled: [{ to: ["proposed"], requires: "reopen" }],
};
