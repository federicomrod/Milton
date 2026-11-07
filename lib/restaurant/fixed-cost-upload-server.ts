// lib/restaurant/fixed-cost-upload-server.ts
//
// #409 · server side of «⇪ Subir archivo» in Costos fijos. A file is parsed on
// the server and NOT stored (storage_path stays null): its lines go to
// fixed_cost_upload_drafts.parsed_lines as DRAFTS. Nothing touches
// restaurant_fixed_costs until `approveDraft`, which saves with source
// 'upload' and writes the history (restaurant_fixed_costs_log). A value already
// in the month is never overwritten without a confirmation (old → new).

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { runChat } from "@/lib/ai/call";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  approvedItems,
  type ClusterItem,
} from "@/lib/restaurant/fixed-cost-clusters";
import {
  FIXED_COST_AI_PROMPT,
  isApprovable,
  keyOfLine,
  nextRepeats,
  normalizeAiLines,
  parseGrid,
  planApproval,
  type DraftLine,
  type DraftScope,
  type ExistingValue,
  type OverwriteConflict,
  type ReadDefaults,
} from "@/lib/restaurant/fixed-cost-upload";
import {
  isRlsDenied,
  validateLine,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";
import type { FixedCostsContext } from "@/lib/restaurant/fixed-costs-server";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface UploadDraft {
  id: string;
  fileName: string | null;
  lines: DraftLine[];
  status: "draft" | "approved" | "discarded";
}

export type ReadFileResult =
  | { ok: true; lines: DraftLine[] }
  | {
      ok: false;
      reason: "unsupported" | "empty" | "ai_unavailable" | "unreadable";
    };

function decodeText(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) text = buffer.toString("latin1");
  return text.replace(/^\uFEFF/, "");
}

/** Rows of cells from an Excel or CSV file. */
export function gridFromSpreadsheet(buffer: Buffer, name: string): unknown[][] {
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) {
    return Papa.parse<string[]>(decodeText(buffer), {
      skipEmptyLines: true,
    }).data as unknown[][];
  }
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: "",
    });
    if (rows.some((r) => r.some((c) => String(c ?? "").trim() !== "")))
      return rows;
  }
  return [];
}

async function askAi(
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  >,
  companyId: string
): Promise<unknown | null> {
  const ai = await runChat({
    feature: "fixed-cost-upload",
    companyId,
    timeoutMs: 45_000,
    params: {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: FIXED_COST_AI_PROMPT },
        { role: "user", content },
      ],
    },
  });
  if (!ai.ok) return null;
  try {
    return JSON.parse(ai.value.choices[0]?.message?.content ?? "null");
  } catch {
    return null;
  }
}

/** Reads one uploaded file into draft lines. Spreadsheets need no AI; PDFs and photos do. */
export async function readUploadedFile(
  file: { name: string; type: string; buffer: Buffer },
  defaults: ReadDefaults,
  companyId: string
): Promise<ReadFileResult> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  try {
    if (/\.(xlsx|xls|csv|txt)$/.test(name)) {
      const lines = parseGrid(gridFromSpreadsheet(file.buffer, name), defaults);
      return lines.length
        ? { ok: true, lines }
        : { ok: false, reason: "empty" };
    }
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const { extractText } = await import("unpdf");
      const { text } = await extractText(new Uint8Array(file.buffer), {
        mergePages: true,
      });
      const body = (Array.isArray(text) ? text.join("\n") : text).trim();
      if (!body) return { ok: false, reason: "unreadable" };
      if (!process.env.OPENAI_API_KEY)
        return { ok: false, reason: "ai_unavailable" };
      const raw = await askAi(
        [{ type: "text", text: body.slice(0, 12_000) }],
        companyId
      );
      if (raw === null) return { ok: false, reason: "ai_unavailable" };
      const lines = normalizeAiLines(raw, defaults);
      return lines.length
        ? { ok: true, lines }
        : { ok: false, reason: "empty" };
    }
    if (
      /^image\/(jpeg|png|webp)$/.test(type) ||
      /\.(jpe?g|png|webp)$/.test(name)
    ) {
      if (!process.env.OPENAI_API_KEY)
        return { ok: false, reason: "ai_unavailable" };
      const mime = /^image\//.test(type) ? type : "image/jpeg";
      const url = `data:${mime};base64,${file.buffer.toString("base64")}`;
      const raw = await askAi(
        [
          { type: "text", text: "Read the fixed costs in this image." },
          { type: "image_url", image_url: { url, detail: "high" } },
        ],
        companyId
      );
      if (raw === null) return { ok: false, reason: "ai_unavailable" };
      const lines = normalizeAiLines(raw, defaults);
      return lines.length
        ? { ok: true, lines }
        : { ok: false, reason: "empty" };
    }
    return { ok: false, reason: "unsupported" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

const DRAFT_COLUMNS = "id, file_name, parsed_lines, status";

type DraftRow = {
  id: string;
  file_name: string | null;
  parsed_lines: unknown;
  status: UploadDraft["status"];
};

const toDraft = (r: DraftRow): UploadDraft => ({
  id: r.id,
  fileName: r.file_name,
  lines: Array.isArray(r.parsed_lines) ? (r.parsed_lines as DraftLine[]) : [],
  status: r.status,
});

export async function createDraft(
  ctx: FixedCostsContext,
  args: {
    fileName: string;
    month: string;
    locationId: string | null;
    lines: DraftLine[];
  }
): Promise<UploadDraft | null> {
  const { data, error } = await ctx.supabase
    .from("fixed_cost_upload_drafts")
    .insert({
      company_id: ctx.companyId,
      location_id: args.locationId,
      month: args.month,
      file_name: args.fileName.slice(0, 200),
      storage_path: null, // the file itself is not kept
      parsed_lines: args.lines,
      status: "draft",
      created_by: ctx.userId,
    })
    .select(DRAFT_COLUMNS)
    .single();
  if (error || !data) return null;
  return toDraft(data as DraftRow);
}

export async function getDraft(
  ctx: FixedCostsContext,
  draftId: string
): Promise<UploadDraft | null> {
  const { data, error } = await ctx.supabase
    .from("fixed_cost_upload_drafts")
    .select(DRAFT_COLUMNS)
    .eq("company_id", ctx.companyId)
    .eq("id", draftId)
    .maybeSingle();
  if (error || !data) return null;
  return toDraft(data as DraftRow);
}

/** The newest open draft of the company, to pick up where the person left. */
export async function latestOpenDraft(
  ctx: FixedCostsContext
): Promise<UploadDraft | null> {
  const { data, error } = await ctx.supabase
    .from("fixed_cost_upload_drafts")
    .select(DRAFT_COLUMNS)
    .eq("company_id", ctx.companyId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return toDraft(data[0] as DraftRow);
}

async function saveLines(
  ctx: FixedCostsContext,
  draft: UploadDraft,
  lines: DraftLine[],
  extra: Record<string, unknown> = {}
): Promise<UploadDraft | null> {
  const open = lines.some((l) => l.status === "pending");
  const { data, error } = await ctx.supabase
    .from("fixed_cost_upload_drafts")
    .update({
      parsed_lines: lines,
      status: open
        ? "draft"
        : lines.some((l) => l.status === "approved")
          ? "approved"
          : "discarded",
      updated_at: new Date().toISOString(),
      ...(open
        ? {}
        : { approved_by: ctx.userId, approved_at: new Date().toISOString() }),
      ...extra,
    })
    .eq("company_id", ctx.companyId)
    .eq("id", draft.id)
    .select(DRAFT_COLUMNS)
    .single();
  if (error || !data) return null;
  return toDraft(data as DraftRow);
}

export interface LineEdit {
  lineId: string;
  category?: FixedCostCategory | null;
  amount?: number | null;
  /** Where the line goes; the route checks a restaurant belongs to the company. */
  scope?: DraftScope;
  /** YYYY-MM-01, for a line whose month was not understood. */
  month?: string;
  discard?: boolean;
}

/** Edits and discards only touch the draft, never Costos fijos. */
export async function editDraft(
  ctx: FixedCostsContext,
  draft: UploadDraft,
  edits: readonly LineEdit[]
): Promise<UploadDraft | null> {
  const byId = new Map(edits.map((e) => [e.lineId, e]));
  const lines = draft.lines.map((l) => {
    const e = byId.get(l.id);
    if (!e || l.status !== "pending") return l;
    return {
      ...l,
      ...(e.category !== undefined ? { category: e.category } : {}),
      ...(e.amount !== undefined ? { amount: e.amount } : {}),
      ...(e.scope !== undefined ? { scope: e.scope } : {}),
      ...(e.month !== undefined ? { month: e.month } : {}),
      ...(e.discard ? { status: "discarded" as const } : {}),
    };
  });
  return saveLines(ctx, draft, lines);
}

export async function discardDraft(
  ctx: FixedCostsContext,
  draft: UploadDraft
): Promise<UploadDraft | null> {
  return saveLines(
    ctx,
    draft,
    draft.lines.map((l) =>
      l.status === "pending" ? { ...l, status: "discarded" as const } : l
    )
  );
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export interface AppliedRow {
  category: FixedCostCategory;
  month: string;
  locationId: string | null;
  /** The cluster's total after this approval (the rate for impuestos). */
  total: number;
  /** The row's value before, null when this approval created it. */
  previous: {
    amount: number | null;
    pct_of_sales: number | null;
    label: string | null;
    source: string | null;
    repeats?: boolean | null;
  } | null;
  /** «Se repite cada mes» of the row after this approval. */
  repeats: boolean;
  /** Every draft line this row stands for. */
  lineIds: string[];
}

export type ApproveResult =
  | {
      ok: true;
      /** Rows actually written to Costos fijos (a group of lines is one row). */
      approved: number;
      /** Lines left pending because their row could not be saved. */
      issues: Array<{ lineId: string; error: string }>;
      /** One entry per saved row: what the cluster is now, and how to undo it. */
      applied: AppliedRow[];
      draft: UploadDraft;
    }
  | { ok: false; conflicts: OverwriteConflict[] }
  | { ok: false; error: "forbidden" | "failed" };

/**
 * Saves the selected lines (default: every approvable one) with source 'upload'
 * and logs each change. Lines of one category/month/scope are saved as ONE row
 * (their sum); all of them are approved together. If any of them would replace a DIFFERENT value already
 * in the month and was not confirmed (`confirmed` = line ids), nothing is
 * written and the conflicts (old → new) come back.
 */
export async function approveDraft(
  ctx: FixedCostsContext,
  draft: UploadDraft,
  args: {
    lineIds?: readonly string[];
    confirmed?: readonly string[];
    /** Line ids whose cluster should ADD to the saved value («Sumar»). */
    adds?: readonly string[];
  }
): Promise<ApproveResult> {
  const wanted = args.lineIds ? new Set(args.lineIds) : null;
  const selected = draft.lines.filter(
    (l) => isApprovable(l) && (!wanted || wanted.has(l.id))
  );
  const months = [...new Set(selected.map((l) => l.month as string))];
  const existing = new Map<string, ExistingValue & { id: string }>();
  if (months.length) {
    const { data, error } = await ctx.supabase
      .from("restaurant_fixed_costs")
      .select(
        "id, location_id, month, category, amount, pct_of_sales, source, label, repeats"
      )
      .eq("company_id", ctx.companyId)
      .in("month", months);
    if (error) return { ok: false, error: "failed" };
    for (const r of (data ?? []) as Array<{
      id: string;
      location_id: string | null;
      month: string;
      category: FixedCostCategory;
      amount: number | string | null;
      pct_of_sales: number | string | null;
      source: string | null;
      label: string | null;
      repeats: boolean | null;
    }>)
      existing.set(
        keyOfLine({
          scope: r.location_id
            ? { kind: "restaurant", locationId: r.location_id }
            : { kind: "group" },
          month: r.month,
          category: r.category,
        } as DraftLine),
        {
          id: r.id,
          amount: r.amount === null ? null : Number(r.amount),
          pct_of_sales: r.pct_of_sales === null ? null : Number(r.pct_of_sales),
          source: r.source,
          label: r.label,
          repeats: r.repeats,
        }
      );
  }
  const addIds = new Set(args.adds ?? []);
  const addKeys = new Set(
    selected.filter((l) => addIds.has(l.id)).map((l) => keyOfLine(l))
  );
  const plan = planApproval(selected, existing, draft.lines, addKeys);
  const confirmed = new Set(args.confirmed ?? []);
  const open = plan.conflicts.filter((c) => !confirmed.has(c.lineId));
  if (open.length) return { ok: false, conflicts: open };

  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  const done = new Set<string>();
  const issues: Array<{ lineId: string; error: string }> = [];
  let written = 0;
  const applied: AppliedRow[] = [];
  for (const { line, members, previous, adds } of plan.writes) {
    const checked = validateLine({
      location_id:
        line.scope?.kind === "restaurant" ? line.scope.locationId : null,
      month: line.month,
      category: line.category,
      label: line.raw,
      value: line.amount,
    });
    if (!checked.ok) {
      // Not saved and not approved: it stays in the draft with the reason.
      for (const m of members)
        issues.push({ lineId: m.id, error: checked.error });
      continue;
    }
    const v = checked.value;
    const prevRow = existing.get(keyOfLine(line));
    const repeats = nextRepeats(members, adds, prevRow?.repeats);
    const row = {
      company_id: ctx.companyId,
      location_id: v.location_id,
      month: v.month,
      category: v.category,
      label: v.label,
      amount: v.amount,
      pct_of_sales: v.pct_of_sales,
      currency,
      source: "upload" as const,
      status: "confirmed" as const,
      repeats,
      split_rule: v.split_rule,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    const result = prevRow
      ? await ctx.supabase
          .from("restaurant_fixed_costs")
          .update(row)
          .eq("company_id", ctx.companyId)
          .eq("id", prevRow.id)
          .select("id")
          .single()
      : await ctx.supabase
          .from("restaurant_fixed_costs")
          .insert({ ...row, created_by: ctx.userId })
          .select("id")
          .single();
    if (result.error)
      return {
        ok: false,
        error: isRlsDenied(result.error) ? "forbidden" : "failed",
      };
    const logged = await ctx.supabase
      .from("restaurant_fixed_costs_log")
      .insert({
        company_id: ctx.companyId,
        fixed_cost_id: (result.data as { id: string }).id,
        location_id: v.location_id,
        month: v.month,
        category: v.category,
        actor: ctx.userId,
        action: previous ? "update" : "create",
        old_value: previous
          ? { amount: previous.amount, pct_of_sales: previous.pct_of_sales }
          : null,
        new_value: { amount: v.amount, pct_of_sales: v.pct_of_sales },
        source: "upload",
      });
    if (logged.error) return { ok: false, error: "failed" };
    for (const m of members) done.add(m.id);
    written += 1;
    applied.push({
      category: v.category,
      month: v.month,
      locationId: v.location_id,
      total: (v.category === "impuestos" ? v.pct_of_sales : v.amount) ?? 0,
      previous: previous
        ? {
            amount: previous.amount,
            pct_of_sales: previous.pct_of_sales,
            label: previous.label ?? null,
            source: previous.source ?? null,
            repeats: previous.repeats ?? null,
          }
        : null,
      repeats,
      lineIds: members.map((m) => m.id),
    });
  }
  for (const l of plan.unchanged) done.add(l.id); // already in Costos fijos with this value
  const lines = draft.lines.map((l) =>
    done.has(l.id) ? { ...l, status: "approved" as const } : l
  );
  const saved = await saveLines(ctx, draft, lines);
  if (!saved) return { ok: false, error: "failed" };
  return { ok: true, approved: written, issues, applied, draft: saved };
}

// ---------------------------------------------------------------------------
// Undo (the «Deshacer» of an inline approval)
// ---------------------------------------------------------------------------

export type UndoResult =
  | { ok: true; draft: UploadDraft }
  | { ok: false; error: "changed" | "failed" | "forbidden" };

/**
 * Puts the rows an approval wrote back to what they were and returns the lines
 * to the draft as pending. A row that changed since (its value is no longer the
 * total this approval wrote, or it is no longer an upload value) is NOT touched:
 * the undo is refused with «changed», never clobbering a later edit.
 */
export async function undoApproval(
  ctx: FixedCostsContext,
  draft: UploadDraft,
  entries: readonly AppliedRow[]
): Promise<UndoResult> {
  // Phase 1: read and check EVERY entry before writing anything, so a refused
  // undo changes nothing at all.
  type Found = { e: AppliedRow; row: Record<string, unknown> | null };
  const found: Found[] = [];
  for (const e of entries) {
    let q = ctx.supabase
      .from("restaurant_fixed_costs")
      .select("id, amount, pct_of_sales, source")
      .eq("company_id", ctx.companyId)
      .eq("month", e.month)
      .eq("category", e.category);
    q = e.locationId
      ? q.eq("location_id", e.locationId)
      : q.is("location_id", null);
    const { data: row, error } = await q.maybeSingle();
    if (error) return { ok: false, error: "failed" };
    if (row) {
      const now =
        e.category === "impuestos"
          ? Number(row.pct_of_sales)
          : Number(row.amount);
      if (row.source !== "upload" || now !== e.total)
        return { ok: false, error: "changed" };
    }
    // No row: already gone, the lines just go back to the draft.
    found.push({ e, row: row as Record<string, unknown> | null });
  }

  // Phase 2: write. If one fails, the entries actually undone still return to
  // pending before the error is reported, so no line says «approved» for a
  // value that is no longer there.
  const undone = new Set<string>();
  let failure: "failed" | "forbidden" | null = null;
  for (const { e, row } of found) {
    if (!row) {
      e.lineIds.forEach((id) => undone.add(id));
      continue;
    }
    const oldValue = { amount: row.amount, pct_of_sales: row.pct_of_sales };
    let newValue: Record<string, unknown> | null;
    if (e.previous) {
      const back = await ctx.supabase
        .from("restaurant_fixed_costs")
        .update({
          amount: e.previous.amount,
          pct_of_sales: e.previous.pct_of_sales,
          label: e.previous.label,
          source: e.previous.source ?? "manual",
          repeats: e.previous.repeats ?? false,
          updated_by: ctx.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", ctx.companyId)
        .eq("id", row.id as string);
      if (back.error) {
        failure = isRlsDenied(back.error) ? "forbidden" : "failed";
        break;
      }
      newValue = {
        amount: e.previous.amount,
        pct_of_sales: e.previous.pct_of_sales,
      };
    } else {
      const gone = await ctx.supabase
        .from("restaurant_fixed_costs")
        .delete()
        .eq("company_id", ctx.companyId)
        .eq("id", row.id as string);
      if (gone.error) {
        failure = isRlsDenied(gone.error) ? "forbidden" : "failed";
        break;
      }
      newValue = null;
    }
    // The row is already back: its lines are undone even if the log fails.
    e.lineIds.forEach((id) => undone.add(id));
    const logged = await ctx.supabase
      .from("restaurant_fixed_costs_log")
      .insert({
        company_id: ctx.companyId,
        fixed_cost_id: row.id as string,
        location_id: e.locationId,
        month: e.month,
        category: e.category,
        actor: ctx.userId,
        action: e.previous ? "update" : "delete",
        old_value: oldValue,
        new_value: newValue,
        source: "upload",
      });
    if (logged.error) {
      failure = "failed";
      break;
    }
  }
  const lines = draft.lines.map((l) =>
    undone.has(l.id) ? { ...l, status: "pending" as const } : l
  );
  const saved = await saveLines(ctx, draft, lines, {
    approved_by: null,
    approved_at: null,
  });
  if (failure) return { ok: false, error: failure };
  if (!saved) return { ok: false, error: "failed" };
  return { ok: true, draft: saved };
}

/**
 * The lines an upload approved into each cluster of a month and scope, so the
 * card still lists them after a reload (Agua $650 / Seguro $3,250). Newest
 * upload first; the page only shows a list that adds up to the card.
 */
export async function loadApprovedItems(
  ctx: FixedCostsContext,
  screen: { month: string; locationId: string | null }
): Promise<Partial<Record<FixedCostCategory, ClusterItem[]>>> {
  const { data, error } = await ctx.supabase
    .from("fixed_cost_upload_drafts")
    .select(DRAFT_COLUMNS)
    .eq("company_id", ctx.companyId)
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) return {};
  const out: Partial<Record<FixedCostCategory, ClusterItem[]>> = {};
  for (const row of data as DraftRow[]) {
    const found = approvedItems(toDraft(row).lines, screen);
    for (const c of Object.keys(found) as FixedCostCategory[])
      if (!out[c]) out[c] = found[c];
  }
  return out;
}
