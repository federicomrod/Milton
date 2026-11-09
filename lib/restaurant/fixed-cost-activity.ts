// lib/restaurant/fixed-cost-activity.ts
//
// Activity = the operations on fixed costs grouped BY COMMAND (one upload, one
// copy, one undo), not one line per history row. Pure: it only reshapes the rows
// of `fixed_cost_commands` that the database already wrote.
//
// Approve → undo → re-approve is three clearly different entries, and the audit
// rows are never merged or hidden. A change is described by comparing before
// and after: an unchanged total is "sin cambio", never an increase.

import type { FixedCostCategory } from "@/lib/restaurant/fixed-costs";

export interface CommandRow {
  id: string;
  kind: string;
  created_at: string;
  draft_id: string | null;
  undo_of: string | null;
  result: Record<string, unknown> | null;
}

export type ActivityKind =
  | "approved"
  | "reapproved"
  | "undone"
  | "copied"
  | "saved"
  | "item";

export interface ActivityChange {
  category: FixedCostCategory;
  month: string;
  locationId: string | null;
  before: number | null;
  after: number | null;
  /** "up" | "down" | "same" | "new" | "removed": derived from before/after only. */
  direction: "up" | "down" | "same" | "new" | "removed";
}

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  at: string;
  /** File name for an upload (and its undo / re-approval). */
  source: string | null;
  months: string[];
  changes: ActivityChange[];
  /** undone / reapproved: the command this one relates to. */
  relatesTo: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;

export function direction(
  before: number | null,
  after: number | null
): ActivityChange["direction"] {
  if (before === null && after === null) return "same";
  if (before === null) return "new";
  if (after === null) return "removed";
  if (Math.round(before * 100) === Math.round(after * 100)) return "same";
  return after > before ? "up" : "down";
}

function change(
  c: Record<string, unknown>,
  swap: boolean
): ActivityChange | null {
  const category = c.category as FixedCostCategory | undefined;
  const month = typeof c.month === "string" ? c.month.slice(0, 10) : null;
  if (!category || !month) return null;
  const a = num(c.previous_total);
  const b = num(c.total);
  const before = swap ? b : a;
  const after = swap ? a : b;
  return {
    category,
    month,
    locationId: typeof c.location_id === "string" ? c.location_id : null,
    before,
    after,
    direction: direction(before, after),
  };
}

function cats(
  result: Record<string, unknown> | null
): Record<string, unknown>[] {
  const list = result?.categories;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

function fileOf(result: Record<string, unknown> | null): string | null {
  const d = result?.draft as { file_name?: unknown } | undefined;
  return typeof d?.file_name === "string" ? d.file_name : null;
}

/**
 * Newest first in, newest first out. `scope`: only entries that touched this
 * restaurant (a string) or the group (null); undefined keeps everything.
 */
export function buildActivity(
  rows: readonly CommandRow[],
  scope?: { locationId: string | null }
): ActivityEntry[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Oldest first, to tell a first approval from a re-approval.
  const asc = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const undoneDrafts = new Set<string>();
  const entries: ActivityEntry[] = [];
  for (const r of asc) {
    if (r.kind === "undo") {
      const target = r.undo_of ? byId.get(r.undo_of) : undefined;
      if (target?.draft_id) undoneDrafts.add(target.draft_id);
      const changes = target
        ? cats(target.result)
            .map((c) => change(c, true))
            .filter((c): c is ActivityChange => c !== null)
        : [];
      entries.push({
        id: r.id,
        kind: "undone",
        at: r.created_at,
        source: target ? fileOf(target.result) : null,
        months: [...new Set(changes.map((c) => c.month))].sort(),
        changes,
        relatesTo: r.undo_of,
      });
      continue;
    }
    const changes = cats(r.result)
      .map((c) => change(c, false))
      .filter((c): c is ActivityChange => c !== null);
    let kind: ActivityKind =
      r.kind === "approve_upload"
        ? "approved"
        : r.kind === "copy"
          ? "copied"
          : r.kind === "save_totals"
            ? "saved"
            : "item";
    if (kind === "approved" && r.draft_id && undoneDrafts.has(r.draft_id))
      kind = "reapproved";
    entries.push({
      id: r.id,
      kind,
      at: r.created_at,
      source: fileOf(r.result),
      months: [...new Set(changes.map((c) => c.month))].sort(),
      changes,
      relatesTo: null,
    });
  }
  const scoped = scope
    ? entries.filter(
        (e) =>
          e.changes.length === 0 ||
          e.changes.some((c) => c.locationId === scope.locationId)
      )
    : entries;
  // A scoped view shows only its own changes inside an entry.
  const trimmed = scope
    ? scoped.map((e) => ({
        ...e,
        changes: e.changes.filter((c) => c.locationId === scope.locationId),
      }))
    : scoped;
  return trimmed.sort((a, b) => (a.at < b.at ? 1 : -1));
}
