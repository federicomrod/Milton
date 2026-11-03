// app/api/restaurant/fixed-costs/upload/route.ts
//
// «⇪ Subir archivo» in Costos fijos (#409). Only owner, admin and manager
// (costs.fixed). The file is parsed on the server and NOT stored; its lines
// become a DRAFT that changes nothing until it is approved
// (…/upload/approve).
//
// GET   → { draft | null }       the company's newest open draft
// POST  multipart { file, month, location_id? } → { draft }
// PATCH { draftId, edits?: [{ lineId, category?, amount?, discard? }],
//         discardAll?: true } → { draft }   (edits only touch the draft)

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import {
  isFixedCostCategory,
  monthStartOf,
} from "@/lib/restaurant/fixed-costs";
import {
  MAX_UPLOAD_BYTES,
  createDraft,
  discardDraft,
  editDraft,
  getDraft,
  latestOpenDraft,
  readUploadedFile,
  type LineEdit,
} from "@/lib/restaurant/fixed-cost-upload-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Guard =
  | { response: NextResponse }
  | {
      t: ReturnType<typeof getDictionary>["costs"]["fixedUpload"];
      auth: Extract<
        Awaited<ReturnType<typeof authorizeFixedCosts>>,
        { ok: true }
      >;
      ctx: { supabase: SupabaseClient; companyId: string; userId: string };
    };

async function guard(): Promise<Guard> {
  const lang = await apiLanguage();
  const dict = getDictionary(lang);
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return { response: auth.response };
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: dict.costs.fixed.roleDenied,
  });
  if (denied) return { response: denied };
  return {
    t: dict.costs.fixedUpload,
    auth,
    ctx: {
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
    },
  };
}

export async function GET(): Promise<NextResponse> {
  const g = await guard();
  if ("response" in g) return g.response;
  return NextResponse.json({ draft: await latestOpenDraft(g.ctx) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guard();
  if ("response" in g) return g.response;
  const { t, auth, ctx } = g;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: t.errNoFile }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: t.errTooBig }, { status: 413 });
  const month = monthStartOf(String(form?.get("month") ?? ""));
  if (!month)
    return NextResponse.json({ error: t.errUnreadable }, { status: 400 });

  const wanted = String(form?.get("location_id") ?? "");
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    wanted || null
  );
  const locationId = wanted ? (context.selected?.locationId ?? null) : null;
  if (wanted && !locationId)
    return NextResponse.json({ error: t.errUnreadable }, { status: 400 });

  const read = await readUploadedFile(
    {
      name: file.name,
      type: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    },
    {
      month,
      scope: locationId
        ? { kind: "restaurant", locationId }
        : { kind: "group" },
      locations: context.locations.map((l) => ({ id: l.id, name: l.name })),
    },
    auth.companyId
  );
  if (!read.ok) {
    const map = {
      unsupported: [t.errUnsupported, 415],
      empty: [t.errEmpty, 422],
      ai_unavailable: [t.errAi, 503],
      unreadable: [t.errUnreadable, 422],
    } as const;
    const [error, status] = map[read.reason];
    return NextResponse.json({ error }, { status });
  }
  const draft = await createDraft(ctx, {
    fileName: file.name,
    month,
    locationId,
    lines: read.lines,
  });
  if (!draft) return NextResponse.json({ error: t.errSave }, { status: 500 });
  return NextResponse.json({ draft });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const g = await guard();
  if ("response" in g) return g.response;
  const { t, ctx } = g;
  const body = (await req.json().catch(() => ({}))) as {
    draftId?: unknown;
    edits?: unknown;
    discardAll?: unknown;
  };
  if (typeof body.draftId !== "string")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  const draft = await getDraft(ctx, body.draftId);
  if (!draft || draft.status !== "draft")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });

  if (body.discardAll === true) {
    const saved = await discardDraft(ctx, draft);
    if (!saved) return NextResponse.json({ error: t.errSave }, { status: 500 });
    return NextResponse.json({ draft: saved });
  }
  const edits: LineEdit[] = [];
  for (const raw of Array.isArray(body.edits) ? body.edits : []) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.lineId !== "string") continue;
    const edit: LineEdit = { lineId: e.lineId };
    if (e.category !== undefined) {
      if (e.category !== null && !isFixedCostCategory(e.category))
        return NextResponse.json({ error: t.errSave }, { status: 400 });
      edit.category = e.category;
    }
    if (e.amount !== undefined) {
      const n = e.amount === null ? null : Number(e.amount);
      if (n !== null && (!Number.isFinite(n) || n <= 0))
        return NextResponse.json({ error: t.noPrice }, { status: 400 });
      edit.amount = n;
    }
    if (e.discard === true) edit.discard = true;
    edits.push(edit);
  }
  const saved = await editDraft(ctx, draft, edits);
  if (!saved) return NextResponse.json({ error: t.errSave }, { status: 500 });
  return NextResponse.json({ draft: saved });
}
