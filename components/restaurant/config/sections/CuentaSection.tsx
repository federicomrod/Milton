// Configuración › Mi cuenta: name, email, password, plan, briefing delivery.
import { AccountCards } from "@/components/restaurant/config/account/AccountCards";
import { getCachedAuthUser } from "@/lib/restaurant/auth-user";
import { createClient } from "@/lib/supabase/server";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";

export async function CuentaSection() {
  const [user, chrome] = await Promise.all([
    getCachedAuthUser(),
    loadRestaurantShellChrome(),
  ]);
  const d = getDictionary(chrome.lang);
  if (!user)
    return (
      <p className="text-sm text-[#64748B]">{d.config.shared.noCompany}</p>
    );

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const row = (profile ?? {}) as {
    full_name?: string | null;
    created_at?: string | null;
    billing_status?: string | null;
  };
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    row.full_name?.trim() ||
    (typeof meta.full_name === "string" ? meta.full_name.trim() : "") ||
    (typeof meta.name === "string" ? meta.name.trim() : "");

  return (
    <AccountCards
      name={name}
      email={user.email ?? ""}
      createdAt={row.created_at ?? user.created_at ?? null}
      billingStatus={row.billing_status ?? null}
    />
  );
}
