// Configuración › Ajustes: language, personal preferences and the company
// details. The ONLY place for company info. Everything is visible read-only
// on load; the language and the preferences save on change, the company
// block edits in place.

import { createClient } from "@/lib/supabase/server";
import {
  getCachedActor,
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { can } from "@/lib/auth/capabilities";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";
import { AjustesClient } from "@/components/restaurant/config/ajustes/AjustesClient";

export async function AjustesSection() {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  const { lang } = await loadRestaurantShellChrome();
  if (!user || !companyId) {
    return (
      <p className="text-sm text-[#64748B]">
        {getDictionary(lang).config.shared.noCompany}
      </p>
    );
  }
  const supabase = await createClient();
  const [actor, companyRes, currency] = await Promise.all([
    getCachedActor(user.id, companyId),
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
    resolveCompanyCurrency(supabase, companyId).catch(() => null),
  ]);
  const row = (companyRes.data ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const meta = user.user_metadata as { preferences?: unknown } | undefined;
  return (
    <AjustesClient
      canEdit={can(actor, "company.edit")}
      company={{
        name: text(row.name),
        legal_name: text(row.legal_name),
        tax_id: text(row.tax_id),
        address: text(row.address),
      }}
      // Migration 070 not applied yet: the columns are not in the row.
      legalAvailable={"legal_name" in row}
      currency={currency}
      preferences={meta?.preferences ?? null}
    />
  );
}
