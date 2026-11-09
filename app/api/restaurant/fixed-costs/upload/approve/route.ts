// app/api/restaurant/fixed-costs/upload/approve/route.ts
//
// POST { draftId, draftVersion, expected: {"<key>": version}, commandKey,
//        lineIds?: string[], decisions?: {"<line id>": "add"|"replace"|"add_duplicate"} }
//   Approves the draft's lines in ONE database transaction (migration 079):
//   items + aggregates + history + the draft's line statuses + the idempotency
//   result commit together or not at all.
//   200 { status, command_id, lines_approved, lines_already_approved,
//         categories, issues, draft, preview }
//   409 { conflicts }          an overlap needs a choice (nothing was written)
//   409 { error, stale: true } the draft or a category changed since the review
//   A repeated commandKey with the same body returns the original result.
//   Only owner, admin and manager (costs.fixed). Company from the session; the
//   database re-checks the writer role and every id.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import {
  approveUpload,
  previewUpload,
  type CommandFailure,
} from "@/lib/restaurant/fixed-cost-commands";
import { getDraft } from "@/lib/restaurant/fixed-cost-upload-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<CommandFailure, number> = {
  stale: 409,
  conflict: 409,
  busy: 503,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  failed: 500,
};
const DECISIONS = new Set(["add", "replace", "add_duplicate"]);

export async function POST(req: NextRequest) {
  const lang = await apiLanguage();
  const dict = getDictionary(lang);
  const t = dict.costs.fixedUpload;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: dict.costs.fixed.roleDenied,
  });
  if (denied) return denied;
  const ctx = {
    supabase: auth.supabase,
    companyId: auth.companyId,
    userId: auth.userId,
  };
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.draftId !== "string")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  if (
    typeof body.commandKey !== "string" ||
    typeof body.draftVersion !== "number" ||
    !Number.isInteger(body.draftVersion) ||
    !body.expected ||
    typeof body.expected !== "object"
  )
    return NextResponse.json({ error: t.errSave }, { status: 400 });

  const expected: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.expected as Record<string, unknown>))
    if (typeof v === "number" && Number.isInteger(v)) expected[k] = v;
  const decisions: Record<string, "add" | "replace" | "add_duplicate"> = {};
  for (const [k, v] of Object.entries(
    (body.decisions as Record<string, unknown>) ?? {}
  ))
    if (typeof v === "string" && DECISIONS.has(v))
      decisions[k] = v as "add" | "replace" | "add_duplicate";
  const lineIds = Array.isArray(body.lineIds)
    ? body.lineIds.filter((x): x is string => typeof x === "string")
    : null;

  const res = await approveUpload(ctx, {
    commandKey: body.commandKey,
    draftId: body.draftId,
    expectedDraftVersion: body.draftVersion,
    expected,
    lineIds,
    decisions,
  });
  if (!res.ok) {
    const error =
      res.failure === "forbidden"
        ? dict.costs.fixed.roleDenied
        : res.failure === "not_found"
          ? t.errNotFound
          : res.failure === "stale"
            ? dict.costs.fixed.staleReload
            : t.errSave;
    return NextResponse.json(
      { error, stale: res.failure === "stale" || undefined },
      { status: STATUS[res.failure] }
    );
  }
  if (res.value.status === "needs_decision")
    return NextResponse.json(
      { conflicts: res.value.conflicts },
      { status: 409 }
    );
  // The next review needs fresh versions: one authoritative read after the commit.
  const draft = await getDraft(ctx, body.draftId);
  const preview =
    draft && draft.status === "draft"
      ? await previewUpload(ctx, draft.id)
      : null;
  return NextResponse.json({
    ...res.value,
    preview: preview && preview.ok ? preview.value : null,
  });
}
