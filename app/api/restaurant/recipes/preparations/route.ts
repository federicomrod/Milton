// GET /api/restaurant/recipes/preparations?location_id=
// The Preparaciones list, ordered by what approving each one unlocks.
// Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadPreparationsOverview } from "@/lib/restaurant/recipe-costing/preparations-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  try {
    const location = req.nextUrl.searchParams.get("location_id");
    const overview = await loadPreparationsOverview(auth.supabase, {
      companyId: auth.companyId,
      locationId: location && location.trim() ? location.trim() : null,
    });
    return NextResponse.json(overview);
  } catch (err) {
    console.error("[recipes/preparations]", err);
    return NextResponse.json(
      { error: "No pude cargar las preparaciones." },
      { status: 500 }
    );
  }
}
