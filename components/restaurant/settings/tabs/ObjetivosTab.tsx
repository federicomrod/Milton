import { can, resolveActor } from "@/lib/auth/permissions";
import { ObjetivosForm } from "@/components/restaurant/settings/ObjetivosForm";
import { AppliesTo } from "@/components/restaurant/settings/AppliesTo";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { fetchCockpitPosRollup } from "@/lib/restaurant/cockpit-pos-rollup";
import { dailyFromRollup, dailyFromRows } from "@/lib/restaurant/cockpit-daily";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import {
  loadDefaultComparison,
  loadTargetsConfig,
} from "@/lib/restaurant/supabase-targets";
import { parseComparison } from "@/lib/restaurant/cockpit-comparison";
import { addDays, buildStartOptions } from "@/lib/restaurant/objetivos";
import { objetivosReferences } from "@/lib/restaurant/objetivos-references";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { periodCostKpisFromDishEconomics } from "@/lib/restaurant/costing/dish-economics-adapter";

/** Configuración › Objetivos: the goals Cockpit and Ventas draw as lines. */
export async function ObjetivosTab({ aplica }: { aplica?: string }) {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    return (
      <p className="text-[13px] text-[#8a92a3]">
        Conecta tu cuenta a una empresa para definir tus objetivos.
      </p>
    );
  }
  const supabase = await createClient();
  const [currency, timezone, locations, config, defaultComparison, actor] =
    await Promise.all([
      resolveCompanyCurrency(supabase, companyId),
      resolvePosTimezone(supabase, companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      loadTargetsConfig(supabase, companyId),
      loadDefaultComparison(supabase, companyId),
      resolveActor(supabase, user.id, { companyId }),
    ]);
  const restaurants = (locations.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const applyTo = restaurants.some((r) => r.id === aplica)
    ? (aplica as string)
    : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date()
  );

  const rollup = await fetchCockpitPosRollup(supabase, companyId, {
    locationId: applyTo,
    timezone,
    currency,
  });
  // The SQL rollup when it is applied; otherwise the same days from the rows.
  const daily = rollup.rollup
    ? dailyFromRollup(rollup.rollup)
    : dailyFromRows(
        (await fetchCompanyPosSalesRows(supabase, companyId, applyTo)).rows,
        timezone,
        currency
      );
  const refs = objetivosReferences(daily, today);
  // "Actual 30 d": the same dish costing as Menú, over the last 30 days of data.
  let cost30: {
    food_cost_pct: number | null;
    gross_margin_pct: number | null;
  } | null = null;
  if (refs.refDay) {
    try {
      const load = await loadDishEconomics(
        companyId,
        addDays(refs.refDay, -29),
        refs.refDay,
        applyTo
      );
      if (load.ok) {
        const k = periodCostKpisFromDishEconomics(load.result);
        cost30 = {
          food_cost_pct: k.food_cost_pct,
          gross_margin_pct: k.gross_margin_pct,
        };
      }
    } catch {
      cost30 = null;
    }
  }

  // «Vigente desde»: the month of the latest sales first (so a goal applies to
  // the data you are looking at, also when the POS data is older than today),
  // then this month, the first month of data, and always.
  const startOptions = buildStartOptions({
    today,
    refDay: refs.refDay,
    firstDay: refs.firstDay,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AppliesTo restaurants={restaurants} value={applyTo} />
      </div>
      <ObjetivosForm
        // A different restaurant is a different form: start it from its own targets.
        key={applyTo ?? "todos"}
        currency={currency}
        restaurants={restaurants}
        applyTo={applyTo}
        rows={config.rows}
        available={config.available}
        refs={refs}
        cost30={cost30}
        today={today}
        startOptions={startOptions}
        defaultComparison={parseComparison(defaultComparison)}
        canEdit={can(actor, "targets.edit")}
      />
    </div>
  );
}
