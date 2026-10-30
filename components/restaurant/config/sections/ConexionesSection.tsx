// Configuración › Conexiones: Odoo + Telegram status and the sales file upload.
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { lastSyncTimestamp } from "@/lib/restaurant/last-synced";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import { getDictionary } from "@/lib/i18n";
import { ConnectionCards } from "@/components/restaurant/config/sites/ConnectionCards";
import { deriveConnectionStatus } from "@/components/restaurant/config/sites/connection-status";

export async function ConexionesSection({
  uploadOpen,
}: {
  uploadOpen?: boolean;
}) {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  const { lang, isAdmin } = await loadRestaurantShellChrome();
  if (!user || !companyId) {
    return (
      <p className="text-[13px] text-[#64748B]">
        {getDictionary(lang).config.sites.restaurants.noCompany}
      </p>
    );
  }
  const supabase = await createClient();
  const readOdoo = (cols: string) =>
    supabase
      .from("restaurant_pos_connections")
      .select(cols)
      .eq("company_id", companyId)
      .eq("is_active", true);
  const [odooFirst, tg] = await Promise.all([
    readOdoo("id, pos_source, last_sync, odoo_company_ids"),
    supabase
      .from("restaurant_telegram_connections")
      .select("company_id, is_active, connected_at")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  let odooRows = odooFirst.data as unknown as Array<Record<string, unknown>>;
  if (
    odooFirst.error &&
    (errorMentionsColumn(odooFirst.error, "last_sync") ||
      errorMentionsColumn(odooFirst.error, "odoo_company_ids"))
  ) {
    const retry = await readOdoo("id, pos_source");
    odooRows = (retry.data ?? []) as unknown as Array<Record<string, unknown>>;
  }
  odooRows = (odooRows ?? []).filter(
    (r) => r.pos_source == null || r.pos_source === "odoo"
  );

  let lastSyncAt: string | null = null;
  let newest = -1;
  let hasUnmatched = false;
  let companiesMissing = false;
  for (const r of odooRows) {
    const ts = lastSyncTimestamp(r.last_sync ?? null);
    if (ts && new Date(ts).getTime() > newest) {
      newest = new Date(ts).getTime();
      lastSyncAt = ts;
    }
    const ul = (r.last_sync as { unmatched_locations?: unknown } | null)
      ?.unmatched_locations;
    if (Array.isArray(ul) && ul.length > 0) hasUnmatched = true;
    if ("odoo_company_ids" in r) {
      const ids = r.odoo_company_ids;
      if (!Array.isArray(ids) || ids.length === 0) companiesMissing = true;
    }
  }
  const odoo = deriveConnectionStatus({
    active: odooRows.length > 0,
    lastSyncAt,
    hasUnmatched,
    companiesMissing,
  });
  const tgRow = tg.data as {
    is_active?: boolean;
    connected_at?: string | null;
  } | null;
  const tgActive = !!tgRow?.is_active;
  const telegram = deriveConnectionStatus({
    active: tgActive,
    lastSyncAt: null,
    noSyncExpected: true,
  });

  return (
    <ConnectionCards
      odoo={{ ...odoo, lastSyncAt }}
      telegram={{
        status: telegram.status,
        connectedAt: tgActive ? (tgRow?.connected_at ?? null) : null,
      }}
      isAdmin={isAdmin}
      uploadOpen={!!uploadOpen}
      lang={lang}
    />
  );
}
