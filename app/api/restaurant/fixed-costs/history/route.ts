// app/api/restaurant/fixed-costs/history/route.ts
//
// GET /api/restaurant/fixed-costs/history[?month=YYYY-MM][&location=<uuid>]
//   → { history } newest first: who changed what, old → new, and the source.

import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { NextRequest, NextResponse } from "next/server";
import { listFixedCostHistory } from "@/lib/restaurant/fixed-costs-server";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const lang = await apiLanguage();
  const fe = getDictionary(lang).costs.fixedErrors;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed");
  if (denied) return denied;
  const rawMonth = req.nextUrl.searchParams.get("month");
  const month = rawMonth ? monthStartOf(rawMonth) : undefined;
  if (rawMonth && !month)
    return NextResponse.json({ error: fe.month }, { status: 400 });
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    req.nextUrl.searchParams.get("location")
  );
  try {
    const history = await listFixedCostHistory(auth.supabase, auth.companyId, {
      month: month ?? undefined,
      locationId: context.selected?.locationId ?? null,
    });
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[fixed-costs] history failed:", err);
    return NextResponse.json({ error: fe.historyFailed }, { status: 500 });
  }
}
