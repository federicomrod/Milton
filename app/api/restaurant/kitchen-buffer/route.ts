// app/api/restaurant/kitchen-buffer/route.ts
//
// PUT /api/restaurant/kitchen-buffer  { locationId, bufferPct (0–30), scope: "today" | "all" }
//   «Merma de cocina» of one restaurant. Only owner, admin and manager (and
//   Milton staff) save; the company comes from the session, never the client,
//   and the restaurant must be one of the company's. → { ok, effectiveFrom }

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import {
  isValidBufferPct,
  loadBusinessToday,
  loadFirstDataDate,
  saveKitchenBuffer,
} from "@/lib/restaurant/kitchen-buffer-server";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const lang = await apiLanguage();
  const b = getDictionary(lang).costs.buffer;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.buffer", {
    message: b.roleDenied,
  });
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    locationId?: unknown;
    bufferPct?: unknown;
    scope?: unknown;
  };
  const scope =
    body.scope === "all" ? "all" : body.scope === "today" ? "today" : null;
  if (
    typeof body.locationId !== "string" ||
    !isValidBufferPct(body.bufferPct) ||
    !scope
  )
    return NextResponse.json({ error: b.invalid }, { status: 400 });

  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    body.locationId
  );
  if (context.selected?.locationId !== body.locationId)
    return NextResponse.json({ error: b.invalid }, { status: 404 });

  try {
    const [today, firstDataDate] = await Promise.all([
      loadBusinessToday(auth.supabase, auth.companyId, body.locationId),
      scope === "all"
        ? loadFirstDataDate(auth.supabase, auth.companyId, body.locationId)
        : Promise.resolve(null),
    ]);
    const res = await saveKitchenBuffer({
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
      locationId: body.locationId,
      bufferPct: body.bufferPct,
      scope,
      today,
      firstDataDate,
    });
    if (!res.ok) {
      const rls = /row-level security|permission denied/i.test(
        res.message ?? ""
      );
      if (!rls) console.error("[kitchen-buffer] save failed:", res.message);
      return NextResponse.json(
        {
          error: rls
            ? b.roleDenied
            : res.error === "invalid"
              ? b.invalid
              : b.saveFailed,
        },
        { status: rls ? 403 : res.error === "invalid" ? 400 : 500 }
      );
    }
    return NextResponse.json({ ok: true, effectiveFrom: res.effectiveFrom });
  } catch (err) {
    console.error("[kitchen-buffer] save failed:", err);
    return NextResponse.json({ error: b.saveFailed }, { status: 500 });
  }
}
