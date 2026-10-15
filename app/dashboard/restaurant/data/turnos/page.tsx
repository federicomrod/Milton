// app/dashboard/restaurant/data/turnos/page.tsx
//
// Configuración › Turnos (R1-17a, mock 3). The shifts of each restaurant and,
// from them, the business-day cutoff. Before migration 054 the page says so.

import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { ConfigTabs } from "@/components/restaurant/settings/ConfigTabs";
import { TurnosForm } from "@/components/restaurant/settings/TurnosForm";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { t } from "@/lib/restaurant/language";
import { loadShifts } from "@/lib/restaurant/business-day-server";
import type { Shift } from "@/lib/restaurant/business-day";

export const dynamic = "force-dynamic";

export default async function TurnosPage() {
  const { lang, isAdmin } = await loadRestaurantShellChrome();
  const header = (
    <>
      <OperatingPageHeader
        title={t(lang, "Settings", "Configuración")}
        lang={lang}
        showDateRange={false}
      />
      <p className="mt-0.5 text-[13px] text-[#6b7385]">
        Turnos: cómo Ventas reparte el día y dónde termina el día de ventas
      </p>
    </>
  );
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    return (
      <div className="w-full px-[26px] pt-4 pb-10">
        {header}
        <p className="mt-4 text-[13px] text-[#8a92a3]">
          Conecta tu cuenta a una empresa para definir tus turnos.
        </p>
      </div>
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
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-4">
      {header}
      <ConfigTabs active="shifts" lang={lang} isAdmin={isAdmin} />
      {restaurants.length === 0 ? (
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
      )}
    </div>
  );
}
