// app/api/restaurant/fixed-costs/upload/undo/route.ts
//
// POST { draftId, applied: AppliedRow[] }  (the `applied` the approve answered)
//   «Deshacer» of an inline approval: the rows that approval wrote go back to
//   what they were, the lines return to the draft as pending, and the history
//   records it. A row edited since is NOT touched: 409 { error } instead.
//   Only owner, admin and manager (costs.fixed). Company from the session.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import {
  getDraft,
  undoApproval,
  type AppliedRow,
} from "@/lib/restaurant/fixed-cost-upload-server";
import {
  isFixedCostCategory,
  monthStartOf,
} from "@/lib/restaurant/fixed-costs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function parseApplied(raw: unknown): AppliedRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const out: AppliedRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const e = r as Record<string, unknown>;
    const month = typeof e.month === "string" ? monthStartOf(e.month) : null;
    const total = num(e.total);
    const lineIds = Array.isArray(e.lineIds)
      ? e.lineIds.filter((x): x is string => typeof x === "string")
      : [];
    const loc = e.locationId;
    if (
      !isFixedCostCategory(e.category) ||
      !month ||
      total === null ||
      lineIds.length === 0 ||
      !(loc === null || (typeof loc === "string" && UUID_RE.test(loc)))
    )
      return null;
    let previous: AppliedRow["previous"] = null;
    if (e.previous && typeof e.previous === "object") {
      const p = e.previous as Record<string, unknown>;
      previous = {
        amount: num(p.amount),
        pct_of_sales: num(p.pct_of_sales),
        label: typeof p.label === "string" ? p.label.slice(0, 120) : null,
        source: typeof p.source === "string" ? p.source : null,
      };
    }
    out.push({
      category: e.category,
      month,
      locationId: loc as string | null,
      total,
      previous,
      lineIds,
    });
  }
  return out;
}

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
    applied?: unknown;
  };
  const applied = parseApplied(body.applied);
  if (typeof body.draftId !== "string" || !applied)
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  const draft = await getDraft(ctx, body.draftId);
  if (!draft)
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });

  const result = await undoApproval(ctx, draft, applied);
  if (result.ok) return NextResponse.json({ draft: result.draft });
  if (result.error === "changed")
    return NextResponse.json({ error: t.undoChanged }, { status: 409 });
  if (result.error === "forbidden")
    return NextResponse.json(
      { error: dict.costs.fixed.roleDenied },
      { status: 403 }
    );
  return NextResponse.json({ error: t.errSave }, { status: 500 });
}
