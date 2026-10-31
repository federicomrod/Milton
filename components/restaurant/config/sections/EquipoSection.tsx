// Configuración › Equipo y acceso. Server component: loads the web members
// (Gestión), pending invites and active cooks (Cocina) for the session's
// company only, then hands plain data to the client panel. Owners also see
// the cook onboarding blocks (App Milton Cocina invites + Telegram QR).

import {
  getCachedActor,
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { isOwnerRole } from "@/lib/auth/capabilities";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { getDictionary } from "@/lib/i18n";
import { TeamPanel } from "../team/TeamPanel";
import {
  roleKind,
  type TeamCook,
  type TeamInvite,
  type TeamMember,
} from "../team/types";
import { KitchenAppInviteCard } from "@/components/restaurant/kitchen/KitchenAppInviteCard";
import { KitchenQrCard } from "@/components/restaurant/kitchen/KitchenQrCard";

const MEMBER_LIMIT = 50;

function cleanText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function EquipoSection() {
  const user = await getCachedAuthUser();
  const companyId = user ? await getCachedCompanyId(user.id) : null;
  if (!user || !companyId) {
    const chrome = await loadRestaurantShellChrome();
    return (
      <p className="text-sm text-[#64748B]">
        {getDictionary(chrome.lang).config.shared.noCompany}
      </p>
    );
  }

  const [actor, chrome, supabase] = await Promise.all([
    getCachedActor(user.id, companyId),
    loadRestaurantShellChrome(),
    createClient(),
  ]);
  const canManage = can(actor, "team.manage");
  const admin = createAdminClient();

  // is_support is migration 072; before it the column does not exist.
  const readMembers = async (columns: string) =>
    admin
      .from("company_memberships")
      .select(columns)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(MEMBER_LIMIT);
  const [membersRes, invitesRes, cooksRes] = await Promise.all([
    readMembers("id, user_id, role, created_at, is_support").then((res) =>
      res.error ? readMembers("id, user_id, role, created_at") : res
    ),
    admin
      .from("workspace_invites")
      // token_hash is never selected.
      .select("id, email, role, expires_at")
      .eq("company_id", companyId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("kitchen_staff")
      .select("id, display_name, location_id, telegram_user_id, joined_at")
      .eq("is_active", true)
      .order("joined_at", { ascending: false }),
  ]);

  const members: TeamMember[] = await Promise.all(
    ((membersRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(
      async (row) => {
        const isSupport = row.is_support === true;
        let name: string | null = null;
        let email: string | null = null;
        // Milton staff: never look the person up, so their name and email
        // cannot reach the client payload (the UI shows «Soporte Milton»).
        if (!isSupport) {
          try {
            const { data } = await admin.auth.admin.getUserById(
              String(row.user_id)
            );
            const u = data?.user;
            email = cleanText(u?.email);
            name =
              cleanText(u?.user_metadata?.full_name) ??
              cleanText(u?.user_metadata?.name);
          } catch {
            // Show the row without a name rather than failing the card.
          }
        }
        return {
          id: String(row.id),
          name,
          email,
          role: roleKind(row.role as string | null),
          isSelf: row.user_id === user.id,
          isSupport,
        };
      }
    )
  );

  const invites: TeamInvite[] = (invitesRes.data ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    role: isOwnerRole(row.role) ? "owner" : "member",
    expiresAt: String(row.expires_at),
  }));

  const siteNames = new Map(chrome.locations.map((l) => [l.id, l.name]));
  const cooks: TeamCook[] = (cooksRes.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.display_name ?? ""),
    location: siteNames.get(String(row.location_id)) ?? null,
    via: row.telegram_user_id == null ? "app" : "telegram",
  }));

  return (
    <div className="space-y-6">
      <TeamPanel
        members={members}
        invites={invites}
        cooks={cooks}
        canManage={canManage}
      />
      {canManage ? (
        <div className="space-y-4">
          <KitchenAppInviteCard locations={chrome.locations} />
          <KitchenQrCard canManage />
        </div>
      ) : null}
    </div>
  );
}
