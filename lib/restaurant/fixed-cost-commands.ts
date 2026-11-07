// lib/restaurant/fixed-cost-commands.ts
//
// The ONLY way the app changes fixed costs. Every function here calls one
// SECURITY DEFINER command of migration 079 with the signed-in user's own
// session (never the service key): the database checks the user's writer role,
// takes the domain locks, validates the expected versions and commits items +
// aggregate + history + draft + idempotency result together, or nothing.
//
// Reading a page, a loader or a preview never calls a writing command.
// Amounts that cross this boundary are integer cents; the currency is resolved
// on the server (`resolveCompanyCurrency`), never taken from the browser.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import type { FixedCostCategory } from "@/lib/restaurant/fixed-costs";

export interface CommandContext {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
}

/** What a failed command means for the person; the route picks the message. */
export type CommandFailure =
  | "stale" // someone changed it since the review: reload and review again
  | "busy" // a domain lock was held too long: safe to retry
  | "forbidden" // not a writer of this company
  | "not_found" // missing, or another company's id (never distinguished)
  | "invalid" // the request itself is wrong
  | "conflict" // a later change blocks this undo
  | "failed";

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: CommandFailure; reason: string };

interface DbError {
  code?: string;
  message?: string;
}

/** Maps a database error to a failure kind. Raw text never reaches the browser. */
export function classifyCommandError(error: DbError): {
  failure: CommandFailure;
  reason: string;
} {
  const code = error.code ?? "";
  const reason = error.message ?? "failed";
  if (code === "FC401" || code === "FC403" || code === "42501")
    return { failure: "forbidden", reason };
  if (code === "FC404") return { failure: "not_found", reason };
  if (code === "FC422") return { failure: "invalid", reason };
  if (code === "FC409")
    return {
      failure:
        reason === "changed_since" || reason === "already_undone"
          ? "conflict"
          : "stale",
      reason,
    };
  if (code === "55P03" || code === "40P01" || code === "40001")
    return { failure: "busy", reason: "busy" };
  return { failure: "failed", reason: "failed" };
}

async function run<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<CommandResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const c = classifyCommandError(error);
    return { ok: false, ...c };
  }
  return { ok: true, value: data as T };
}

/** A fresh idempotency key. The browser sends its own so a lost response can be retried. */
export const newCommandKey = (): string => randomUUID();

export const toCents = (n: number): number => Math.round(n * 100);

// ---------------------------------------------------------------------------
// Upload review and approval
// ---------------------------------------------------------------------------

export interface PreviewKey {
  key: string;
  loc: string | null;
  month: string;
  category: FixedCostCategory;
  kind: "new" | "noop" | "continue" | "overlap" | "invalid_duplicate_tax";
  version: number;
  old_cents: number | null;
  detail_state: "legacy_total" | "itemized" | null;
  existing_items: Array<{
    id: string;
    label: string | null;
    cents: number;
    kind: "item" | "legacy_base";
    version: number;
  }>;
  incoming_cents: number;
  add_total_cents: number;
  duplicate_line_ids: string[];
  lines: Array<{ id: string; raw: string; cents: number }>;
}

export interface UploadPreview {
  draft_id: string;
  draft_version: number;
  file_name: string | null;
  same_file_seen_before: boolean;
  keys: PreviewKey[];
}

export interface ApprovedCategory {
  key: string;
  category: FixedCostCategory;
  month: string;
  location_id: string | null;
  outcome: "created" | "added" | "replaced" | "unchanged";
  total: number | null;
  previous_total: number | null;
  version: number;
  repeats?: boolean;
  line_ids: string[];
}

export interface DraftConflict {
  lineId: string;
  key: string;
  kind: "overlap" | "duplicate";
  category: FixedCostCategory;
  month: string;
  scope: { kind: "group" } | { kind: "restaurant"; locationId: string };
  old: number | null;
  new: number;
  newIfAdd: number;
  existingItems: PreviewKey["existing_items"];
  incoming: PreviewKey["lines"];
  duplicateLineIds: string[];
  detailState?: string | null;
}

export type ApproveValue =
  | {
      status: "applied" | "noop";
      command_id: string;
      replayed: boolean;
      /** Lines committed by THIS command (successful, new). */
      lines_approved: number;
      /** Lines that were already in Costos fijos with the same reviewed values. */
      lines_already_approved: number;
      categories: ApprovedCategory[];
      issues: Array<{ lineId: string; error: string }>;
      draft: {
        id: string;
        version: number;
        status: "draft" | "approved" | "discarded";
        file_name: string | null;
        lines: unknown[];
      };
    }
  | { status: "needs_decision"; conflicts: DraftConflict[] };

export function previewUpload(ctx: CommandContext, draftId: string) {
  return run<UploadPreview>(ctx.supabase, "fixed_cost_preview_upload", {
    p_draft_id: draftId,
  });
}

export async function approveUpload(
  ctx: CommandContext,
  args: {
    commandKey: string;
    draftId: string;
    expectedDraftVersion: number;
    expected: Record<string, number>;
    lineIds?: readonly string[] | null;
    decisions?: Record<string, "add" | "replace" | "add_duplicate">;
  }
) {
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  return run<ApproveValue>(ctx.supabase, "fixed_cost_approve_upload", {
    p_command_key: args.commandKey,
    p_draft_id: args.draftId,
    p_expected_draft_version: args.expectedDraftVersion,
    p_expected: args.expected,
    p_line_ids: args.lineIds ? [...args.lineIds] : null,
    p_decisions: args.decisions ?? {},
    p_currency: currency,
  });
}

// ---------------------------------------------------------------------------
// Manual commands
// ---------------------------------------------------------------------------

export interface SaveEntry {
  category: FixedCostCategory;
  /** null = an empty field: the category is removed (never stored as 0). */
  value: number | null;
  label?: string | null;
  repeats?: boolean;
  split_rule?: "sales" | "equal" | null;
  /** Replace the known items of this category by this one total. */
  replaceItems?: boolean;
  /** The version the form was loaded with (0 = the category did not exist). */
  expectedVersion: number;
}

export interface SaveValue {
  status: "applied" | "noop";
  changed: Array<{
    key: string;
    category: FixedCostCategory;
    action: string;
    version: number;
  }>;
  command_id?: string;
}

export async function saveTotals(
  ctx: CommandContext,
  args: {
    commandKey: string;
    month: string;
    locationId: string | null;
    entries: SaveEntry[];
  }
) {
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  return run<SaveValue>(ctx.supabase, "fixed_cost_save_totals", {
    p_command_key: args.commandKey,
    p_company: ctx.companyId,
    p_month: args.month,
    p_location: args.locationId,
    p_entries: args.entries.map((e) => ({
      category: e.category,
      value: e.value,
      label: e.label ?? null,
      repeats: e.repeats === true,
      split_rule: e.split_rule ?? null,
      replace_items: e.replaceItems === true,
      expected_version: e.expectedVersion,
    })),
    p_currency: currency,
  });
}

export async function itemCommand(
  ctx: CommandContext,
  args: {
    commandKey: string;
    op: "add" | "update" | "delete";
    month: string;
    locationId: string | null;
    category: Exclude<FixedCostCategory, "impuestos">;
    itemId?: string | null;
    label?: string | null;
    cents?: number | null;
    expectedAggregateVersion: number;
    expectedItemVersion?: number | null;
  }
) {
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  return run<{
    status: string;
    key: string;
    version: number;
    total: number | null;
  }>(ctx.supabase, "fixed_cost_item_command", {
    p_command_key: args.commandKey,
    p_company: ctx.companyId,
    p_op: args.op,
    p_location: args.locationId,
    p_month: args.month,
    p_category: args.category,
    p_item_id: args.itemId ?? null,
    p_label: args.label ?? null,
    p_amount_cents: args.cents ?? null,
    p_expected_agg_version: args.expectedAggregateVersion,
    p_expected_item_version: args.expectedItemVersion ?? null,
    p_currency: currency,
  });
}

// ---------------------------------------------------------------------------
// Explicit copy
// ---------------------------------------------------------------------------

export interface CopyPreviewCategory {
  category: FixedCostCategory;
  state: "no_source" | "missing_in_destination" | "same" | "conflict";
  source_changed_since_copy: boolean;
  source: null | {
    version: number;
    amount: number | null;
    pct_of_sales: number | null;
    detail_state: "legacy_total" | "itemized";
    items: Array<{
      id: string;
      label: string | null;
      amount_cents: number;
      kind: string;
    }>;
  };
  destination: null | {
    version: number;
    amount: number | null;
    pct_of_sales: number | null;
    detail_state: "legacy_total" | "itemized";
    copy_source: { month: string; aggregate_version: number } | null;
    items: Array<{
      id: string;
      label: string | null;
      amount_cents: number;
      kind: string;
    }>;
  };
  destination_version: number;
}

export interface CopyPreview {
  from: string;
  to: string;
  location_id: string | null;
  categories: CopyPreviewCategory[];
}

export function previewCopy(
  ctx: CommandContext,
  args: { from: string; to: string; locationId: string | null }
) {
  return run<CopyPreview>(ctx.supabase, "fixed_cost_preview_copy", {
    p_company: ctx.companyId,
    p_location: args.locationId,
    p_from: args.from,
    p_to: args.to,
  });
}

export type CopyValue =
  | {
      status: "applied" | "noop";
      command_id?: string;
      copied: Array<{
        category: FixedCostCategory;
        action: string;
        version: number;
      }>;
    }
  | {
      status: "needs_decision";
      conflicts: Array<{
        category: FixedCostCategory;
        destinationKey: string;
        old: number | null;
        new: number | null;
      }>;
    };

export async function copyMonth(
  ctx: CommandContext,
  args: {
    commandKey: string;
    from: string;
    to: string;
    locationId: string | null;
    categories: FixedCostCategory[];
    decisions?: Partial<Record<FixedCostCategory, "replace" | "skip">>;
    expected: Record<string, number>;
  }
) {
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  return run<CopyValue>(ctx.supabase, "fixed_cost_copy", {
    p_command_key: args.commandKey,
    p_company: ctx.companyId,
    p_location: args.locationId,
    p_from: args.from,
    p_to: args.to,
    p_categories: args.categories,
    p_decisions: args.decisions ?? {},
    p_expected: args.expected,
    p_currency: currency,
  });
}

// ---------------------------------------------------------------------------
// Undo: only a command id. The before-state is the server's, never the browser's.
// ---------------------------------------------------------------------------

export function undoCommand(
  ctx: CommandContext,
  args: { commandKey: string; commandId: string }
) {
  return run<{
    status: string;
    undone: string;
    draft: {
      id: string;
      version: number;
      status: string;
      lines: unknown[];
    } | null;
  }>(ctx.supabase, "fixed_cost_undo", {
    p_command_key: args.commandKey,
    p_target: args.commandId,
  });
}
