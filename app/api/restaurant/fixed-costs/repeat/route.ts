// app/api/restaurant/fixed-costs/repeat/route.ts
//
// POST /api/restaurant/fixed-costs/repeat  { month }
//   Copies the previous month's «repetir cada mes» lines into `month`.
//   Idempotent: never duplicates and never overwrites a value already there.
//   → { created }

import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { NextRequest, NextResponse } from "next/server";
import { repeatFixedCosts } from "@/lib/restaurant/fixed-costs-server";
import { isRlsDenied, monthStartOf } from "@/lib/restaurant/fixed-costs";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const lang = await apiLanguage();
  const fe = getDictionary(lang).costs.fixedErrors;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: getDictionary(lang).costs.fixed.roleDenied,
  });
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { month?: unknown };
  const month =
    typeof body.month === "string" ? monthStartOf(body.month) : null;
  if (!month) return NextResponse.json({ error: fe.month }, { status: 400 });
  try {
    const created = await repeatFixedCosts(
      {
        supabase: auth.supabase,
        companyId: auth.companyId,
        userId: auth.userId,
      },
      month
    );
    return NextResponse.json({ created: created.length });
  } catch (err) {
    if (isRlsDenied(err))
      return NextResponse.json(
        { error: getDictionary(lang).costs.fixed.roleDenied },
        { status: 403 }
      );
    console.error("[fixed-costs] repeat failed:", err);
    return NextResponse.json({ error: fe.repeatFailed }, { status: 500 });
  }
}
