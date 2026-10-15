// app/dashboard/restaurant/data/restaurante/page.tsx
//
// Configuración › Restaurante: rename (and, with migration 055, archive) the
// restaurants of the company.

import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { ConfigTabs } from "@/components/restaurant/settings/ConfigTabs";
import { RestaurantNamesForm } from "@/components/restaurant/settings/RestaurantNamesForm";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";
import { t } from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";

export default async function RestaurantSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const [{ lang, isAdmin }, { location }] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  const header = (
    <>
      <OperatingPageHeader
        title={t(lang, "Settings", "Configuración")}
        lang={lang}
        showDateRange={false}
      />
      <p className="mt-0.5 text-[13px] text-[#6b7385]">
        Restaurante: el nombre que ves en toda la app
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
          Conecta tu cuenta a una empresa para cambiar el nombre de tu
          restaurante.
        </p>
      </div>
    );
  }
  const supabase = await createClient();
  const { locations, archiveAvailable } = await listAllCompanyRestaurants(
    supabase,
    companyId
  );
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-4">
      {header}
      <ConfigTabs active="restaurant" lang={lang} isAdmin={isAdmin} />
      {locations.length === 0 ? (
        <p className="text-[13px] text-[#8a92a3]">Aún no hay restaurantes.</p>
      ) : (
        <RestaurantNamesForm
          restaurants={locations.map((l) => ({
            id: l.id,
            name: l.name,
            archived: !!l.archived_at,
          }))}
          archiveAvailable={archiveAvailable}
          currentId={
            locations.some((l) => l.id === location)
              ? (location as string)
              : null
          }
        />
      )}
    </div>
  );
}
