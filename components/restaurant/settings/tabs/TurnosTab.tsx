import { TurnosForm } from "@/components/restaurant/settings/TurnosForm";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadShifts } from "@/lib/restaurant/business-day-server";
import type { Shift } from "@/lib/restaurant/business-day";

/** Configuración › Turnos: the shifts of each restaurant and the business-day cutoff. */
export async function TurnosTab() {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    return (
      <p className="text-[13px] text-[#8a92a3]">
        Conecta tu cuenta a una empresa para definir tus turnos.
      </p>
    );
  }
  const supabase = await createClient();
  const [loaded, locations] = await Promise.all([
    loadShifts(supabase, companyId),
    supabase
      .from("restaurant_locations")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
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
  return restaurants.length === 0 ? (
    <p className="text-[13px] text-[#8a92a3]">
      Aún no hay restaurantes para definir turnos.
    </p>
  ) : (
    <TurnosForm
      restaurants={restaurants}
      shiftsByRestaurant={shiftsByRestaurant}
      available={loaded.available}
      canEdit={true}
    />
  );
}
