// lib/restaurant/mobile-manager/home.ts
//
// Inicio for the phone. Everything comes from the same functions as the web:
// Ventas de ayer from the Ventas cube (vs the same weekday last week), Ganancia
// del mes from loadRentabilidadPage, «Lo que destaca» from the Rentabilidad
// findings (real month data, in the web's own wording) and the pending Compras
// invoices. No insight is made up: with nothing to say the list is empty.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { loadSalesDetailCached } from "@/lib/restaurant/sales-detail-server";
import { viewFor } from "@/lib/restaurant/mobile-manager/sales";
import {
  buildRentabilidad,
  type RentabilidadPayload,
} from "@/lib/restaurant/mobile-manager/rentabilidad";
import { loadPendingInvoices } from "@/lib/restaurant/mobile-manager/costos";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";

export interface HomePayload {
  currency: string;
  /** The restaurant in view (null = all). */
  locationId: string | null;
  yesterday: {
    date: string;
    net: number | null;
    delta: number | null;
    compareLabel: string;
    tickets: number | null;
  } | null;
  /** null when no single restaurant is in view («Elige un restaurante»). */
  month: Pick<
    RentabilidadPayload,
    "month" | "hasData" | "basis" | "profit" | "profitPct" | "isCurrentMonth"
  > | null;
  needsRestaurant: boolean;
  highlights: Array<{ id: string; text: string; link: "rentabilidad" }>;
  pending: { count: number; firstInvoiceId: string | null };
}

export async function buildHome(args: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string | null;
  singleLocationId: string | null;
  restaurantIds: string[];
  lang: PreferredLanguage;
  now?: Date;
}): Promise<HomePayload> {
  const { supabase, companyId, locationId, singleLocationId, lang } = args;
  const sales = await loadSalesDetailCached(supabase, companyId, locationId);
  const view = viewFor(sales, "day", lang);

  let rent: RentabilidadPayload | null = null;
  if (singleLocationId) {
    try {
      rent = await buildRentabilidad({
        supabase,
        companyId,
        locationId: singleLocationId,
        restaurantIds: args.restaurantIds,
        month: monthStartOf(args.now ?? new Date()) as string,
        lang,
      });
    } catch (err) {
      console.error(
        "[mobile-home] rentabilidad failed:",
        err instanceof Error ? err.name : "Unknown error"
      );
    }
  }
  const pending = await loadPendingInvoices(supabase, companyId).catch(
    () => null
  );

  return {
    currency: sales.currency,
    locationId,
    yesterday:
      view && !view.empty
        ? {
            date: view.range.to,
            net: view.kpis.net.value,
            delta: view.kpis.net.delta,
            compareLabel: view.compare.label,
            tickets: view.kpis.tickets.value,
          }
        : null,
    month: rent
      ? {
          month: rent.month,
          hasData: rent.hasData,
          basis: rent.basis,
          profit: rent.profit,
          profitPct: rent.profitPct,
          isCurrentMonth: rent.isCurrentMonth,
        }
      : null,
    needsRestaurant: singleLocationId === null,
    highlights: (rent?.findings ?? []).map((text, i) => ({
      id: `finding-${i}`,
      text,
      link: "rentabilidad" as const,
    })),
    pending: {
      count: pending?.pendingCount ?? 0,
      firstInvoiceId: pending?.invoices[0]?.id ?? null,
    },
  };
}
