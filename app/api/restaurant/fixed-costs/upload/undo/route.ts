// app/api/restaurant/fixed-costs/upload/undo/route.ts
//
// POST { commandId, commandKey }   «Deshacer» of an approval (or any command).
//   The database derives what to restore from the command's own committed
//   before-state; the browser sends NO values. If anything touched those
//   categories since, the undo is refused with 409 { error } and nothing is
//   changed. It is its own audited command, atomic with its history rows.
//   Only owner, admin and manager (costs.fixed). Company from the session.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { undoCommand } from "@/lib/restaurant/fixed-cost-commands";
import { getDraft } from "@/lib/restaurant/fixed-cost-upload-server";
import { previewUpload } from "@/lib/restaurant/fixed-cost-commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    commandId?: unknown;
    commandKey?: unknown;
  };
  if (
    typeof body.commandId !== "string" ||
    !UUID_RE.test(body.commandId) ||
    typeof body.commandKey !== "string"
  )
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });

  const res = await undoCommand(ctx, {
    commandId: body.commandId,
    commandKey: body.commandKey,
  });
  if (res.ok) {
    const id = res.value.draft?.id;
    const draft = id ? await getDraft(ctx, id) : null;
    const preview =
      draft && draft.status === "draft"
        ? await previewUpload(ctx, draft.id)
        : null;
    return NextResponse.json({
      draft,
      preview: preview && preview.ok ? preview.value : null,
    });
  }
  if (res.failure === "conflict")
    return NextResponse.json({ error: t.undoChanged }, { status: 409 });
  if (res.failure === "forbidden")
    return NextResponse.json(
      { error: dict.costs.fixed.roleDenied },
      { status: 403 }
    );
  if (res.failure === "not_found")
    return NextResponse.json({ error: t.errNotFound }, { status: 404 });
  return NextResponse.json({ error: t.errSave }, { status: 500 });
}
