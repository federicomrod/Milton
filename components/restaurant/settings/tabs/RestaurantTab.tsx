import { RestaurantNamesForm } from "@/components/restaurant/settings/RestaurantNamesForm";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";

/** Configuración › Restaurante: rename (and, with migration 055, archive) the restaurants of the company. */
export async function RestaurantTab({ location }: { location?: string }) {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    return (
      <p className="text-[13px] text-[#8a92a3]">
        Conecta tu cuenta a una empresa para cambiar el nombre de tu
        restaurante.
      </p>
    );
  }
  const supabase = await createClient();
  const { locations, archiveAvailable } = await listAllCompanyRestaurants(
    supabase,
    companyId
  );
  return locations.length === 0 ? (
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
        locations.some((l) => l.id === location) ? (location as string) : null
      }
    />
  );
}
