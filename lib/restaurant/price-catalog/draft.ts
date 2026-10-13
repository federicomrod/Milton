// The cost-file upload as a draft that survives leaving the page: the
// picked file, the person's choices (saved as they go), and what was
// already saved from it. One per company (migration 044). Company always
// comes from auth.

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";

const TABLE = "cost_upload_drafts";
/** Same cap as the upload itself. */
export const MAX_DRAFT_FILE_BYTES = 15 * 1024 * 1024;

export type DraftConflictChoice = "catalog" | number | "none";

/** The preview choices, exactly as the panel keeps them. */
export interface DraftDecisions {
  /** Row key → unit picked, or "none" (Ninguna: leave it Pendiente). */
  units: Record<string, string>;
  /** Row key → true when the person buys it ready-made (an ingredient). */
  asIngredient: Record<string, boolean>;
  /** Conflict key → which cost, or "none". */
  conflicts: Record<string, DraftConflictChoice>;
  /** "Revisé estas unidades" ticked. */
  reviewedUnits: boolean;
}

export interface UploadDraft {
  filename: string;
  file_size: number;
  decisions: DraftDecisions;
  catalog_result: Record<string, unknown> | null;
  recipes_result: Record<string, unknown> | null;
  updated_at: string | null;
}

export function emptyDraftDecisions(): DraftDecisions {
  return { units: {}, asIngredient: {}, conflicts: {}, reviewedUnits: false };
}

const UNIT_RE = /^(oz|lb|unit|g|none)$/;
const KEY_MAX = 300;
const ENTRIES_MAX = 2000;

/** Keep only well-formed choices; anything else is dropped. */
export function parseDraftDecisions(raw: unknown): DraftDecisions {
  const out = emptyDraftDecisions();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const body = raw as Record<string, unknown>;
  const entries = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key.length > 0 && key.length <= KEY_MAX)
          .slice(0, ENTRIES_MAX)
      : [];
  for (const [key, value] of entries(body.units)) {
    if (typeof value === "string" && UNIT_RE.test(value))
      out.units[key] = value;
  }
  for (const [key, value] of entries(body.asIngredient)) {
    if (value === true) out.asIngredient[key] = true;
  }
  for (const [key, value] of entries(body.conflicts)) {
    if (value === "catalog" || value === "none") out.conflicts[key] = value;
    else if (
      Number.isInteger(value) &&
      (value as number) >= 0 &&
      (value as number) < 100
    ) {
      out.conflicts[key] = value as number;
    }
  }
  out.reviewedUnits = body.reviewedUnits === true;
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** True when the error says migration 044 is not applied yet. */
function missingTable(error: { message?: string } | null): boolean {
  return Boolean(error && errorMentionsColumn(error, TABLE));
}

export async function loadUploadDraft(
  supabase: SupabaseClient,
  companyId: string
): Promise<UploadDraft | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "filename, file_size, decisions, catalog_result, recipes_result, updated_at"
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return {
    filename: String(data.filename),
    file_size: Number(data.file_size ?? 0),
    decisions: parseDraftDecisions(data.decisions),
    catalog_result: asRecord(data.catalog_result),
    recipes_result: asRecord(data.recipes_result),
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

/** The draft's file, for the preview and the save. */
export async function loadUploadDraftFile(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("filename, file_base64")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(error.message);
  }
  if (!data || typeof data.file_base64 !== "string") return null;
  return {
    buffer: Buffer.from(data.file_base64, "base64"),
    filename: String(data.filename),
  };
}

/** A new file replaces the draft: its choices and results start empty. */
export async function saveUploadDraftFile(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    userId: string | null;
    filename: string;
    buffer: Buffer;
  }
): Promise<{ ok: true } | { ok: false; missingTable: boolean; error: string }> {
  const { error } = await supabase.from(TABLE).upsert(
    {
      company_id: input.companyId,
      filename: input.filename,
      file_base64: input.buffer.toString("base64"),
      file_size: input.buffer.length,
      decisions: emptyDraftDecisions(),
      catalog_result: null,
      recipes_result: null,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );
  if (error) {
    return {
      ok: false,
      missingTable: missingTable(error),
      error: error.message,
    };
  }
  return { ok: true };
}

export async function updateUploadDraft(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    userId: string | null;
    decisions?: DraftDecisions;
    catalog_result?: Record<string, unknown> | null;
    recipes_result?: Record<string, unknown> | null;
  }
): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };
  if (input.decisions !== undefined) patch.decisions = input.decisions;
  if (input.catalog_result !== undefined)
    patch.catalog_result = input.catalog_result;
  if (input.recipes_result !== undefined)
    patch.recipes_result = input.recipes_result;
  const { error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("company_id", input.companyId);
  if (error && !missingTable(error)) throw new Error(error.message);
}

export async function deleteUploadDraft(
  supabase: SupabaseClient,
  companyId: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("company_id", companyId);
  if (error && !missingTable(error)) throw new Error(error.message);
}

/**
 * The preview choices as the price-list save reads them: only what the
 * person answered. "none" is never sent as a unit, so that row stays
 * Pendiente.
 */
export function catalogDecisionsFromDraft(
  draft: DraftDecisions,
  rows: ReadonlyArray<{ key: string; kind: string; status: string }>
): {
  rows: Record<string, unknown>;
  conflicts: Record<string, DraftConflictChoice>;
} {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const unit = draft.units[row.key];
    const asks =
      row.kind === "ingredient" &&
      (row.status === "ambiguous_unit" ||
        (row.status === "check_unit" && draft.reviewedUnits));
    if (asks && unit && unit !== "none") out[row.key] = { unit };
    if (row.kind === "preparation" && draft.asIngredient[row.key]) {
      out[row.key] = { ...(out[row.key] ?? {}), kind: "ingredient" };
    }
  }
  return { rows: out, conflicts: draft.conflicts };
}
