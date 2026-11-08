// lib/restaurant/fixed-cost-overview-server.ts
//
// READ side of the multi-month overview. It calls the same loaders as the single
// month view (`loadFixedCostsView`: same lines, items, group shares, margin and
// the shared engine) once per month of the window, so the overview can never
// disagree with Rentabilidad or the phone payload. Nothing here writes.

import {
  listFixedCosts,
  loadFixedCostsView,
  type FixedCostsContext,
  type FixedCostsView,
  type MarginRead,
} from "@/lib/restaurant/fixed-costs-server";
import {
  buildOverview,
  monthWindow,
  shiftMonth,
  type Overview,
} from "@/lib/restaurant/fixed-cost-overview";
import {
  buildActivity,
  type ActivityEntry,
  type CommandRow,
} from "@/lib/restaurant/fixed-cost-activity";
import type { FixedCostLine } from "@/lib/restaurant/fixed-costs";

export interface OverviewLoad {
  overview: Overview;
  /** The view of each month of the window (restaurant list, currency, openDays…). */
  views: Record<string, FixedCostsView>;
  currency: string;
}

export async function loadFixedCostOverview(
  ctx: FixedCostsContext,
  args: {
    endMonth: string;
    locationId: string | null;
    brandId: string | null;
    restaurantIds: string[];
    marginFor: (month: string) => Promise<MarginRead>;
    size?: number;
  }
): Promise<OverviewLoad> {
  const months = monthWindow(args.endMonth, args.size ?? 3);
  const [views, earlier] = await Promise.all([
    Promise.all(
      months.map(async (month) =>
        loadFixedCostsView(ctx, {
          month,
          locationId: args.locationId,
          brandId: args.brandId,
          restaurantIds: args.restaurantIds,
          marginRead: await args.marginFor(month),
        })
      )
    ),
    // Two months before the window: only to find a recurring reference.
    Promise.all(
      [1, 2].map((n) =>
        listFixedCosts(
          ctx.supabase,
          ctx.companyId,
          shiftMonth(months[0], -n),
          args.locationId
        ).catch(() => [] as FixedCostLine[])
      )
    ),
  ]);
  const overview = buildOverview(
    views.map((v) => ({
      month: v.month,
      lines: v.lines,
      items: v.items,
      groupShares: v.groupShares,
      groupImpuestosPct: v.groupImpuestosPct,
      figures: v.figures,
    })),
    earlier.flat()
  );
  const byMonth: Record<string, FixedCostsView> = {};
  for (const v of views) byMonth[v.month] = v;
  return { overview, views: byMonth, currency: views[0]?.currency ?? "USD" };
}

/** Recent operations grouped by command. Read-only. */
export async function loadFixedCostActivity(
  ctx: FixedCostsContext,
  locationId: string | null,
  limit = 40
): Promise<ActivityEntry[]> {
  const { data, error } = await ctx.supabase
    .from("fixed_cost_commands")
    .select("id, kind, created_at, draft_id, undo_of, result")
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  // Before migration 079 the table does not exist: no activity, not an error.
  if (error) return [];
  return buildActivity((data ?? []) as unknown as CommandRow[], { locationId });
}
