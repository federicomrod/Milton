// app/dashboard/restaurant/kitchen/page.tsx
//
// "Kitchen (Telegram)" — manager page for the kitchen QR join and cook
// reports (R1 #55 / #49): wall QR per location, active cooks, newest
// reports. Auth-gated by proxy.ts, rendered inside RestaurantShell. Any
// company member can read; only owners and Milton admins can create/rotate
// QRs, remove cooks or reclassify reports (enforced again server-side).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";
import { KitchenQrCard } from "@/components/restaurant/kitchen/KitchenQrCard";
import { KitchenStaffCard } from "@/components/restaurant/kitchen/KitchenStaffCard";
import { KitchenReportsCard } from "@/components/restaurant/kitchen/KitchenReportsCard";
import { KitchenRecipeDraftsCard } from "@/components/restaurant/kitchen/KitchenRecipeDraftsCard";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { t } from "@/lib/restaurant/language";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId) redirect("/dashboard/restaurant");

  const [isMiltonAdmin, membershipRole, locationsRes] = await Promise.all([
    isUserAdminServer(user.id),
    loadMembershipRole(companyId, user.id),
    supabase
      .from("restaurant_locations")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
  ]);
  const canManage = canManageKitchenQr({ isMiltonAdmin, membershipRole });
  const locations = (locationsRes.data ?? []) as { id: string; name: string }[];
  const { lang } = await loadRestaurantShellChrome();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div className="space-y-2">
        <OperatingPageHeader
          title={t(lang, "Kitchen", "Cocina")}
          lang={lang}
          showDateRange={false}
        />
        <p className="text-sm text-muted-foreground">
          {t(
            lang,
            "Let your cooks report what's running out, 86'd or wasted — by text, voice note or photo — just by scanning a QR.",
            "Tus cocineros pueden avisar qué se está acabando, qué está agotado (86) o qué se desperdició — por texto, nota de voz o foto — solo escaneando un código QR."
          )}
        </p>
      </div>
      <KitchenQrCard canManage={canManage} />
      <KitchenStaffCard canManage={canManage} locations={locations} />
      <KitchenRecipeDraftsCard canManage={canManage} locations={locations} />
      <KitchenReportsCard canManage={canManage} locations={locations} />
    </div>
  );
}
