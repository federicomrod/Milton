// app/management/clients/page.tsx
//
// Administración › Clientes: every company with «Abrir cuenta» (support access,
// migration 072) and the last opens. Behind the /management admin gate; the
// open itself is the server action, which checks is_milton_admin again.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { listRecentSupportOpens } from "@/lib/support/support-access";
import { ClientsList } from "@/components/management/clients-list";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const admin = createAdminClient();
  const user = await getCachedAuthUser();
  const [companies, opens, activeCompanyId] = await Promise.all([
    admin.from("companies").select("id, name").order("name"),
    listRecentSupportOpens(admin, 20),
    user?.id ? getCachedCompanyId(user.id) : Promise.resolve(null),
  ]);
  return (
    <ClientsList
      companies={(companies.data ?? []).map((c) => ({
        id: c.id as string,
        name: (c.name as string) ?? "",
      }))}
      loadFailed={!!companies.error}
      opens={opens}
      activeCompanyId={activeCompanyId}
    />
  );
}
