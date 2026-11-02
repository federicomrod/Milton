// app/api/restaurant/fixed-costs/upload/approve/route.ts
//
// POST { draftId, lineIds?: string[], confirmed?: string[] }
//   Approves the draft's lines (all the ready ones, or the ids given): they are
//   saved to restaurant_fixed_costs with source 'upload' and logged. If a line
//   would REPLACE a different value already in its month, nothing is written
//   and 409 { conflicts: [{ lineId, category, month, old, new }] } comes back;
//   the person confirms (confirmed: [lineId…]) and sends it again.
//   Only owner, admin and manager (costs.fixed).

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import {
  approveDraft,
  getDraft,
} from "@/lib/restaurant/fixed-cost-upload-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const body = (await req.json().catch(() => ({}))) as {
    draftId?: unknown;
    lineIds?: unknown;
    confirmed?: unknown;
  };
  if (typeof body.draftId !== "string")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  const draft = await getDraft(ctx, body.draftId);
  if (!draft || draft.status !== "draft")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  const ids = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : undefined;

  const result = await approveDraft(ctx, draft, {
    lineIds: ids(body.lineIds),
    confirmed: ids(body.confirmed),
  });
  if (result.ok) return NextResponse.json(result);
  if ("conflicts" in result)
    return NextResponse.json({ conflicts: result.conflicts }, { status: 409 });
  if (result.error === "forbidden")
    return NextResponse.json(
      { error: dict.costs.fixed.roleDenied },
      { status: 403 }
    );
  return NextResponse.json({ error: t.errSave }, { status: 500 });
}
