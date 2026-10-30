// GET /api/restaurant/recipes/preparations?location_id=
// The Preparaciones list, ordered by what approving each one unlocks.
// Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { loadPreparationsOverview } from "@/lib/restaurant/recipe-costing/preparations-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const lang = await apiLanguage();
  try {
    const location = req.nextUrl.searchParams.get("location_id");
    const overview = await loadPreparationsOverview(auth.supabase, {
      companyId: auth.companyId,
      lang,
      locationId: location && location.trim() ? location.trim() : null,
    });
    return NextResponse.json(overview);
  } catch (err) {
    console.error("[recipes/preparations]", err);
    return NextResponse.json(
      { error: getDictionary(lang).menu.editor.api.preparationsLoadFailed },
      { status: 500 }
    );
  }
}
