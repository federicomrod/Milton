// app/api/mobile/v1/costos/route.ts
//
// GET: the pending Compras invoices (with their lines) and, below them, the
// month's cost KPIs read-only. `canApprove` tells the app whether to draw the
// Aprobar / Rechazar buttons (prices.edit, the web approve route's capability).

import { NextRequest } from "next/server";
import {
  authManager,
  managerError,
} from "@/lib/restaurant/mobile-manager/auth";
import { loadPendingInvoices } from "@/lib/restaurant/mobile-manager/costos";
import { buildRentabilidad } from "@/lib/restaurant/mobile-manager/rentabilidad";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";
import { can } from "@/lib/auth/permissions";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  try {
    const pending = await loadPendingInvoices(auth.supabase, auth.companyId);
    let kpis = null;
    if (auth.singleLocationId) {
      const rent = await buildRentabilidad({
        supabase: auth.supabase,
        companyId: auth.companyId,
        locationId: auth.singleLocationId,
        restaurantIds: auth.locations.map((l) => l.id),
        month: monthStartOf(new Date()) as string,
        lang: auth.lang,
      }).catch(() => null);
      if (rent) {
        kpis = {
          month: rent.month,
          hasData: rent.hasData,
          basis: rent.basis,
          sales: rent.sales,
          foodCostPct: rent.foodCostPct,
          fixedTotal: rent.fixedTotal,
        };
      }
    }
    return mobileJson({
      ...pending,
      canApprove: can(auth.actor, "prices.edit"),
      kpis,
      needsRestaurant: auth.singleLocationId === null,
    });
  } catch (err) {
    console.error(
      "[mobile-costos] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return managerError(request, "managerLoadFailed", 500);
  }
}
