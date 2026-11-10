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
  buildRentabilidadWithLatest,
  type RentabilidadPayload,
} from "@/lib/restaurant/mobile-manager/rentabilidad";
import type { DataReasons } from "@/lib/restaurant/mobile-manager/data-quality";
import { loadPendingInvoices } from "@/lib/restaurant/mobile-manager/costos";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";

/**
 * The four KPI cards under «Ventas de ayer». Added field: an older app build
 * ignores it. Every figure is one the web / the other tabs already show:
 * `sales` is the Ventas › Mes cube view, `profit` the Rentabilidad screen's
 * lead month (with its latest-month fallback), `reasons` the Costos data
 * quality (food cost and planilla share are read from it, never recomputed).
 */
export interface HomeCards {
  /** Month to date, exactly the Ventas › Mes total and its comparison. null = no sales yet. */
  sales: {
    value: number | null;
    /** % change vs the same days of last month. */
    delta: number | null;
    compareLabel: string;
    /** The days the total covers. */
    range: { from: string; to: string };
  } | null;
  /** The month the cost cards are about (first day), null without a single restaurant. */
  month: string | null;
  profit: {
    /** The month the profit is of: this one, or the latest with data. */
    month: string;
    /** True when it is an earlier month because this one has no profit yet. */
    isLatest: boolean;
    value: number;
    /** 0–1 */
    pct: number | null;
    basis: "real" | "estimada";
  } | null;
  /** Costos' «Costo de ventas» number (0–100) and why it may be missing. */
  foodCostPct: number | null;
  reasons: DataReasons | null;
}

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
    /** Net sales of the last days, oldest first (the sparkline). */
    trend: number[];
  } | null;
  /** null when no single restaurant is in view («Elige un restaurante»). */
  month: Pick<
    RentabilidadPayload,
    "month" | "hasData" | "basis" | "profit" | "profitPct" | "isCurrentMonth"
  > | null;
  needsRestaurant: boolean;
  cards: HomeCards;
  highlights: Array<{
    id: string;
    text: string;
    kind: string;
    link: "rentabilidad";
  }>;
  pending: {
    count: number;
    firstInvoiceId: string | null;
    /** Up to two supplier names, for the one-line summary. */
    suppliers: string[];
  };
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
  const weekView = viewFor(sales, "week", lang);
  const monthView = viewFor(sales, "month", lang);

  let rent: RentabilidadPayload | null = null;
  let latest: RentabilidadPayload | null = null;
  if (singleLocationId) {
    try {
      const rentArgs = {
        supabase,
        companyId,
        locationId: singleLocationId,
        restaurantIds: args.restaurantIds,
        month: monthStartOf(args.now ?? new Date()) as string,
        lang,
      };
      rent = await buildRentabilidad(rentArgs);
      // No profit yet this month: the same latest-month fallback as the
      // Rentabilidad screen, only loaded when it is needed.
      if (!(rent.hasData && rent.profit !== null)) {
        latest = (await buildRentabilidadWithLatest(rentArgs)).latest;
      }
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
            trend: (weekView?.daily ?? []).map((d) => d.net),
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
    cards: {
      sales:
        monthView && !monthView.empty
          ? {
              value: monthView.kpis.net.value,
              delta: monthView.kpis.net.delta,
              compareLabel: monthView.compare.label,
              range: monthView.range,
            }
          : null,
      month: rent?.month ?? null,
      profit: profitCard(rent, latest),
      foodCostPct: rent?.reasons.foodCost.pct ?? null,
      reasons: rent?.reasons ?? null,
    },
    highlights: (rent?.findings ?? []).map((text, i) => ({
      id: `finding-${i}`,
      text,
      kind: rent?.findingKinds[i] ?? "",
      link: "rentabilidad" as const,
    })),
    pending: {
      count: pending?.pendingCount ?? 0,
      firstInvoiceId: pending?.invoices[0]?.id ?? null,
      suppliers: [
        ...new Set(
          (pending?.invoices ?? [])
            .map((i) => i.supplier)
            .filter((n): n is string => !!n)
        ),
      ].slice(0, 2),
    },
  };
}

/** The month the profit card leads with: this one, else the latest with data. */
function profitCard(
  rent: RentabilidadPayload | null,
  latest: RentabilidadPayload | null
): HomeCards["profit"] {
  if (!rent) return null;
  const pick = rent.hasData && rent.profit !== null ? rent : (latest ?? null);
  if (!pick || pick.profit === null) return null;
  return {
    month: pick.month,
    isLatest: pick !== rent,
    value: pick.profit,
    pct: pick.profitPct,
    basis: pick.basis,
  };
}
