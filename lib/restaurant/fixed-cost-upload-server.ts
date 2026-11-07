// lib/restaurant/fixed-cost-upload-server.ts
//
// #409 · server side of «⇪ Subir archivo» in Costos fijos. A file is parsed on
// the server and NOT stored (storage_path stays null): its lines go to
// fixed_cost_upload_drafts.parsed_lines as DRAFTS. A draft is a work area:
// reading, editing and discarding it never touches restaurant_fixed_costs.
// Approving (and undoing) is a database command (lib/restaurant/
// fixed-cost-commands.ts, migration 079): items, aggregate, history and draft
// change together or not at all.

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { runChat } from "@/lib/ai/call";
import {
  FIXED_COST_AI_PROMPT,
  normalizeAiLines,
  parseGrid,
  type DraftLine,
  type DraftScope,
  type ReadDefaults,
} from "@/lib/restaurant/fixed-cost-upload";
import type { FixedCostCategory } from "@/lib/restaurant/fixed-costs";
import type { FixedCostsContext } from "@/lib/restaurant/fixed-costs-server";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface UploadDraft {
  id: string;
  /** Moves on every content change; an approval must send the one it reviewed. */
  version: number;
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

const DRAFT_COLUMNS = "id, file_name, parsed_lines, status, version";

type DraftRow = {
  id: string;
  file_name: string | null;
  parsed_lines: unknown;
  status: UploadDraft["status"];
  version: number;
};

const toDraft = (r: DraftRow): UploadDraft => ({
  id: r.id,
  version: r.version ?? 1,
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
    /** Hash of the uploaded bytes: evidence of file identity, never the sole identity. */
    fileSha256?: string | null;
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
      file_sha256: args.fileSha256 ?? null,
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
