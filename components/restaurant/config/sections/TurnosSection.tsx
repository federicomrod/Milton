import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";
import { can } from "@/lib/auth/capabilities";
import { TurnosCard } from "@/components/restaurant/config/goals/TurnosCard";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedActor,
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadShifts } from "@/lib/restaurant/business-day-server";
import type { Shift } from "@/lib/restaurant/business-day";

/** Configuración › Turnos: the shifts of each restaurant and the business-day cutoff. */
export async function TurnosSection() {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    const { lang } = await loadRestaurantShellChrome();
    return (
      <p className="text-sm text-[#64748B]">
        {getDictionary(lang).config.shared.noCompany}
      </p>
    );
  }
  const supabase = await createClient();
  const [loaded, locations, actor] = await Promise.all([
    loadShifts(supabase, companyId),
    supabase
      .from("restaurant_locations")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    getCachedActor(user.id, companyId),
  ]);
  const restaurants = (locations.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const shiftsByRestaurant: Record<string, Shift[]> = {};
  for (const s of loaded.shifts) {
    (shiftsByRestaurant[s.restaurant_id] ??= []).push({
      name: s.name,
      start_time: s.start_time,
      end_time: s.end_time,
      weekdays: s.weekdays,
      active: s.active,
    });
  }
  return (
    <TurnosCard
      restaurants={restaurants}
      shiftsByRestaurant={shiftsByRestaurant}
      available={loaded.available}
      canEdit={can(actor, "shifts.edit")}
    />
  );
}
