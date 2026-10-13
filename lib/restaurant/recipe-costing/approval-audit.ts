// Who approved a recipe version (dish or preparation), and when.
// Migration 041 adds approved_by / approved_at / approved_how to
// recipe_versions and component_recipe_versions.

import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";

export interface ApprovalRecord {
  approved_by: string;
  approved_at: string;
  /** "en_pantalla", or how the client confirmed (Milton staff). */
  approved_how: string;
}

export function approvalRecord(input: {
  userId: string;
  how?: string | null;
  at?: string;
}): ApprovalRecord {
  return {
    approved_by: input.userId,
    approved_at: input.at ?? new Date().toISOString(),
    approved_how: input.how?.trim() || "en_pantalla",
  };
}

type UpdateResult = PromiseLike<{
  error: {
    message: string;
    details?: string;
    hint?: string;
    code?: string;
  } | null;
}>;

/**
 * Run an approval update with the audit columns. Before migration 041 is
 * applied the columns do not exist: the approval still goes through (the
 * notes keep saying "Aprobada") and the missing audit is logged.
 */
export async function updateWithApprovalAudit(
  run: (payload: Record<string, unknown>) => UpdateResult,
  payload: Record<string, unknown>,
  record: ApprovalRecord
): Promise<{ audited: boolean }> {
  const first = await run({ ...payload, ...record });
  if (!first.error) return { audited: true };
  if (!errorMentionsColumn(first.error, "approved_by")) {
    throw new Error(first.error.message);
  }
  console.warn(
    "[approval-audit] migration 041 not applied: approved without approved_by/approved_at"
  );
  const retry = await run(payload);
  if (retry.error) throw new Error(retry.error.message);
  return { audited: false };
}
