// Configuración › Restaurantes: one row per location, read-only on load.
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";
import {
  RestaurantRows,
  type SiteRow,
} from "@/components/restaurant/config/sites/RestaurantRows";

interface Extra {
  address: string | null;
  city: string | null;
  odoo_company_id: number | null;
}

export async function RestaurantesSection({ location }: { location?: string }) {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  const { lang } = await loadRestaurantShellChrome();
  const t = getDictionary(lang).config.sites.restaurants;
  if (!user || !companyId) {
    return <p className="text-[13px] text-[#64748B]">{t.noCompany}</p>;
  }
  const supabase = await createClient();
  const [{ locations, archiveAvailable }, extraRes] = await Promise.all([
    listAllCompanyRestaurants(supabase, companyId),
    // address / city are baseline; odoo_company_id is migration 025. A failed
    // read (older schema) only hides these fields, never the restaurants.
    supabase
      .from("restaurant_locations")
      .select("id, address, city, odoo_company_id")
      .eq("company_id", companyId),
  ]);
  const extra = new Map<string, Extra>();
  for (const r of (extraRes.data ?? []) as unknown as Array<
    Extra & { id: string }
  >) {
    extra.set(r.id, r);
  }
  if (locations.length === 0) {
    return <p className="text-[13px] text-[#64748B]">{t.none}</p>;
  }
  const rows: SiteRow[] = locations.map((l) => {
    const e = extra.get(l.id);
    return {
      id: l.id,
      name: l.name,
      address: e?.address ?? null,
      city: e?.city ?? null,
      odooCompanyId: e?.odoo_company_id ?? null,
      archived: !!l.archived_at,
    };
  });
  return (
    <RestaurantRows
      rows={rows}
      archiveAvailable={archiveAvailable}
      currentId={
        locations.some((l) => l.id === location) ? (location as string) : null
      }
    />
  );
}
