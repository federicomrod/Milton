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
  FIXED_COST_AI_PROMPT,
  isApprovable,
  keyOfLine,
  normalizeAiLines,
  parseGrid,
  planApproval,
  type DraftLine,
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

export type ApproveResult =
  | { ok: true; approved: number; draft: UploadDraft }
  | { ok: false; conflicts: OverwriteConflict[] }
  | { ok: false; error: "forbidden" | "failed" };

/**
 * Saves the selected lines (default: every approvable one) with source 'upload'
 * and logs each change. If any of them would replace a DIFFERENT value already
 * in the month and was not confirmed (`confirmed` = line ids), nothing is
 * written and the conflicts (old → new) come back.
 */
export async function approveDraft(
  ctx: FixedCostsContext,
  draft: UploadDraft,
  args: { lineIds?: readonly string[]; confirmed?: readonly string[] }
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
      .select("id, location_id, month, category, amount, pct_of_sales")
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
        }
      );
  }
  const plan = planApproval(selected, existing);
  const confirmed = new Set(args.confirmed ?? []);
  const open = plan.conflicts.filter((c) => !confirmed.has(c.lineId));
  if (open.length) return { ok: false, conflicts: open };

  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  const done = new Set<string>();
  for (const { line, previous } of plan.writes) {
    const checked = validateLine({
      location_id:
        line.scope?.kind === "restaurant" ? line.scope.locationId : null,
      month: line.month,
      category: line.category,
      label: line.raw,
      value: line.amount,
    });
    if (!checked.ok) continue;
    const v = checked.value;
    const prevRow = existing.get(keyOfLine(line));
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
      repeats: false,
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
    done.add(line.id);
  }
  for (const l of plan.unchanged) done.add(l.id); // already in Costos fijos with this value
  const lines = draft.lines.map((l) =>
    done.has(l.id) ? { ...l, status: "approved" as const } : l
  );
  const saved = await saveLines(ctx, draft, lines);
  if (!saved) return { ok: false, error: "failed" };
  return { ok: true, approved: plan.writes.length, draft: saved };
}
