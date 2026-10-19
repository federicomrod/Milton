// app/api/restaurant/shifts/route.ts
//
// GET  /api/restaurant/shifts → { available, shifts, cutoffs }       (migration 054)
// POST /api/restaurant/shifts   { restaurant_id, shifts: [{name, start_time,
//        end_time, weekdays, active}] } → { saved, cutoff }
//
// The whole set of shifts of one restaurant is saved in ONE transaction by
// restaurant_shifts_save (SECURITY DEFINER; a non-member gets 42501;
// overlapping active shifts get 22023 with a Spanish message). The company is
// resolved from the user, never taken from the client.

import { revalidateSales } from "@/lib/restaurant/cache-tags";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  requireCapability,
  resolveActor,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import { loadShifts } from "@/lib/restaurant/business-day-server";
import {
  cutoffMinutes,
  minutesToTime,
  validateShifts,
  type Shift,
} from "@/lib/restaurant/business-day";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authAndCompany() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: unauthorizedResponse(),
    };
  }
  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "No company resolved for user" },
        { status: 404 }
      ),
    };
  }
  return { ok: true as const, supabase, companyId, userId: user.id };
}

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const loaded = await loadShifts(auth.supabase, auth.companyId);
  const cutoffs: Record<string, string> = {};
  const byRestaurant = new Map<string, Shift[]>();
  for (const s of loaded.shifts)
    byRestaurant.set(s.restaurant_id, [
      ...(byRestaurant.get(s.restaurant_id) ?? []),
      s,
    ]);
  for (const [id, list] of byRestaurant)
    cutoffs[id] = minutesToTime(cutoffMinutes(list));
  return NextResponse.json({
    available: loaded.available,
    shifts: loaded.shifts,
    cutoffs,
  });
}

function parseShifts(raw: unknown): Shift[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Shift[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") return null;
    const r = e as Record<string, unknown>;
    if (
      typeof r.name !== "string" ||
      typeof r.start_time !== "string" ||
      typeof r.end_time !== "string"
    )
      return null;
    const weekdays = Array.isArray(r.weekdays)
      ? r.weekdays.filter((d): d is number => Number.isInteger(d))
      : [];
    out.push({
      name: r.name,
      start_time: r.start_time,
      end_time: r.end_time,
      weekdays,
      active: r.active !== false,
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "shifts.edit");
  if (denied) return denied;
  let body: { restaurant_id?: unknown; shifts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const restaurantId =
    typeof body.restaurant_id === "string" ? body.restaurant_id : "";
  if (!UUID.test(restaurantId)) {
    return NextResponse.json(
      { error: "Elige un restaurante." },
      { status: 400 }
    );
  }
  const shifts = parseShifts(body.shifts);
  if (!shifts) {
    return NextResponse.json(
      { error: "Los turnos no tienen el formato esperado." },
      { status: 400 }
    );
  }
  const check = validateShifts(shifts);
  if (!check.ok)
    return NextResponse.json({ error: check.message }, { status: 400 });

  const { data, error } = await auth.supabase.rpc("restaurant_shifts_save", {
    p_company_id: auth.companyId,
    p_restaurant_id: restaurantId,
    p_shifts: shifts.map((s) => ({
      name: s.name.trim(),
      start_time: s.start_time,
      end_time: s.end_time,
      weekdays: s.weekdays,
      active: s.active,
    })),
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return NextResponse.json(
        { error: "Tu rol no puede cambiar los turnos." },
        { status: 403 }
      );
    }
    if (code === "22023") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // The function does not exist yet (054 not applied).
    if (
      code === "PGRST202" ||
      code === "42883" ||
      /restaurant_shifts_save/.test(error.message)
    ) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar la migración 054 en este ambiente: todavía no se pueden guardar turnos.",
        },
        { status: 409 }
      );
    }
    console.error("[shifts] save failed:", error.message);
    return NextResponse.json(
      { error: "No pude guardar los turnos." },
      { status: 500 }
    );
  }
  const out = (data ?? {}) as { saved?: number; cutoff?: string };
  // Shifts and the business-day cutoff shape the sales cube.
  revalidateSales(auth.companyId);
  return NextResponse.json({
    saved: out.saved ?? shifts.length,
    cutoff: out.cutoff ?? null,
  });
}
