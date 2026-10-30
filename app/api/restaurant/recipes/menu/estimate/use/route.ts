// POST /api/restaurant/recipes/menu/estimate/use   Body (JSON): { menu_item_id }
//
// «Usar como borrador»: copy Milton's estimated quantities into the dish's
// menu draft. Existing lines without qty are filled; missing estimated
// lines are appended. A Sin receta plato with no draft gets the same empty
// menu-draft shell «Leer tu menú» writes, then the lines. No ingredient,
// no cost entry; the version stays in review («Borrador») and the dish's
// real status does not change. A dish that has meanwhile got an approved
// recipe, a Confirmado link with a real recipe, or an Excel or hand-made
// one, is refused and nothing is written. Owner, admin, manager or Milton
// staff.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { applyEstimateAsDraft } from "@/lib/restaurant/menu-reading/estimate-server";
import { apiDictionary } from "@/lib/restaurant/api-lang";

const apiMsg = async () => (await apiDictionary()).menu.workspace.api;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit", {
    message: (await apiMsg()).roleCannotPrepare,
  });
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // handled below
  }
  const menuItemId =
    typeof body.menu_item_id === "string" ? body.menu_item_id.trim() : "";
  if (!menuItemId) {
    return NextResponse.json(
      { error: (await apiMsg()).estimateUseNeedsDish },
      { status: 400 }
    );
  }
  try {
    const out = await applyEstimateAsDraft(auth.supabase, {
      companyId: auth.companyId,
      menuItemId,
    });
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.status });
    }
    return NextResponse.json({
      ok: true,
      applied: out.applied,
      not_copied: out.not_copied,
      used_as_draft_at: out.used_as_draft_at,
      version_status: out.version_status,
    });
  } catch {
    console.error("[recipes-menu-estimate-use]");
    return NextResponse.json(
      { error: (await apiMsg()).estimateUseFailed },
      { status: 500 }
    );
  }
}
