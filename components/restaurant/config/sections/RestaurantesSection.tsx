// Configuración › Restaurantes: one row per location, read-only on load.
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import Link from "next/link";
import { COSTS_HREF } from "@/lib/restaurant/navigation";
import {
  loadBusinessToday,
  loadRestaurantBuffers,
} from "@/lib/restaurant/kitchen-buffer-server";
import { BUFFER_ANCHOR, pctText } from "@/lib/restaurant/merma-format";
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
  // «Merma de cocina»: the same value as Costos, one tap away (no tabs).
  let buffers: Awaited<ReturnType<typeof loadRestaurantBuffers>> = [];
  try {
    const active = locations.filter((l) => !l.archived_at);
    if (active.length > 0) {
      const today = await loadBusinessToday(supabase, companyId, active[0].id);
      buffers = await loadRestaurantBuffers(
        supabase,
        companyId,
        active.map((l) => ({ id: l.id, name: l.name })),
        today
      );
    }
  } catch (err) {
    console.error("[config] kitchen buffer read failed:", err);
  }
  const b = getDictionary(lang).costs.buffer;
  return (
    <div className="space-y-4">
      <RestaurantRows
        rows={rows}
        archiveAvailable={archiveAvailable}
        currentId={
          locations.some((l) => l.id === location) ? (location as string) : null
        }
      />
      {buffers.length > 0 ? (
        <ul
          data-testid="config-kitchen-buffer"
          className="divide-y divide-[#eef1f8] rounded-[14px] border border-[#dbe3f7] bg-white px-4"
        >
          {buffers.map((r) => (
            <li
              key={r.locationId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px] text-[#0F172A]"
            >
              {buffers.length > 1 ? (
                <span className="font-semibold">{r.name}</span>
              ) : null}
              <span>
                {b.line.replace("{pct}", pctText(r.bufferPct, lang))}
                {r.isDefault ? (
                  <span className="ml-1.5 text-[12px] text-[#6b7385]">
                    {b.defaultTag}
                  </span>
                ) : null}
              </span>
              <Link
                href={`${COSTS_HREF}?${new URLSearchParams({ location: r.locationId }).toString()}#${BUFFER_ANCHOR}`}
                className="text-[13px] font-semibold text-[#1B40C8] underline"
              >
                {b.configLink}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
