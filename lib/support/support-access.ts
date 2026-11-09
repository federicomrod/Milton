// lib/support/support-access.ts
//
// Milton staff support access (migration 072). Server-only; every function
// takes the service-role client and is keyed by the caller's own user id, so
// callers must have checked the person first (is_milton_admin for opening an
// account, membership for switching).
//
//   «Abrir cuenta»  -> a real company_memberships row (role admin, is_support)
//                      + the active company switched + an audit row.
//   switcher        -> the companies the user belongs to; picking one sets the
//                      active company (profiles.company_id, which
//                      resolveCompanyIdForUser already honours among the
//                      user's memberships).
//   «Salir»         -> back to the user's own company.
// RLS is untouched: support reaches a client through a normal membership, so
// is_company_member / has_company_role answer as for any member.
// Nothing here logs a token or a raw error message (err.name only).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserCompany {
  id: string;
  name: string;
  /** This membership is Milton support (the flag from migration 072). */
  isSupport: boolean;
}

function logFailure(scope: string, err: unknown): void {
  console.error(
    `[support-access] ${scope}:`,
    err instanceof Error ? err.name : "Unknown error"
  );
}

/** The columns/tables of 072 are not there yet (migration not applied). */
export function isMissingSupportSchema(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return (
    e?.code === "42703" ||
    e?.code === "42P01" ||
    /is_support|support_account_opens/i.test(String(e?.message ?? ""))
  );
}

/** Points profiles.company_id at the company (the row is keyed by id and/or user_id). */
async function setActiveCompany(
  admin: SupabaseClient,
  userId: string,
  companyId: string
): Promise<boolean> {
  const byId = await admin
    .from("profiles")
    .update({ company_id: companyId })
    .eq("id", userId)
    .select("id");
  if (!byId.error && (byId.data?.length ?? 0) > 0) return true;
  const byUser = await admin
    .from("profiles")
    .update({ company_id: companyId })
    .eq("user_id", userId)
    .select("id");
  if (!byUser.error && (byUser.data?.length ?? 0) > 0) return true;
  // No profile row yet: create it (id and user_id only, as migration 011).
  const created = await admin
    .from("profiles")
    .insert({ id: userId, user_id: userId, company_id: companyId });
  return !created.error;
}

/** Every company the user belongs to, oldest membership first. */
export async function listUserCompanies(
  admin: SupabaseClient,
  userId: string
): Promise<UserCompany[]> {
  try {
    const { data, error } = await admin
      .from("company_memberships")
      .select("company_id, is_support, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    let rows = data as
      | { company_id: string; is_support?: boolean | null }[]
      | null;
    if (error) {
      // Before 072 there is no is_support column: nobody is support.
      if (!isMissingSupportSchema(error)) return [];
      const fallback = await admin
        .from("company_memberships")
        .select("company_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (fallback.error) return [];
      rows = fallback.data as { company_id: string }[];
    }
    const memberships = (rows ?? []).filter((r) => !!r.company_id);
    if (memberships.length === 0) return [];
    const { data: companies } = await admin
      .from("companies")
      .select("id, name")
      .in(
        "id",
        memberships.map((m) => m.company_id)
      );
    const names = new Map(
      ((companies ?? []) as { id: string; name: string | null }[]).map((c) => [
        c.id,
        c.name ?? "",
      ])
    );
    return memberships.map((m) => ({
      id: m.company_id,
      name: names.get(m.company_id) ?? "",
      isSupport: m.is_support === true,
    }));
  } catch (err) {
    logFailure("list companies", err);
    return [];
  }
}

export type OpenAccountResult =
  | { ok: true; companyId: string; companyName: string }
  | { ok: false; reason: "company" | "migration" | "error" };

/**
 * «Abrir cuenta». The caller has verified is_milton_admin. Adds the support
 * membership when the user is not a member yet (an existing real membership is
 * left exactly as it is), makes the company active and logs the open.
 */
export async function openClientAccount(
  admin: SupabaseClient,
  input: { userId: string; userEmail: string | null; companyId: string }
): Promise<OpenAccountResult> {
  try {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name")
      .eq("id", input.companyId)
      .maybeSingle();
    if (companyError) return { ok: false, reason: "error" };
    if (!company) return { ok: false, reason: "company" };

    const { data: existing, error: findError } = await admin
      .from("company_memberships")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (findError) {
      return {
        ok: false,
        reason: isMissingSupportSchema(findError) ? "migration" : "error",
      };
    }

    let createdMembership = false;
    if (!existing) {
      const { error: insertError } = await admin
        .from("company_memberships")
        .insert({
          company_id: input.companyId,
          user_id: input.userId,
          role: "admin",
          is_support: true,
        });
      if (insertError) {
        return {
          ok: false,
          reason: isMissingSupportSchema(insertError) ? "migration" : "error",
        };
      }
      createdMembership = true;
    }

    // The audit row is part of the open: no log, no open.
    const { error: auditError } = await admin
      .from("support_account_opens")
      .insert({
        company_id: input.companyId,
        user_id: input.userId,
        user_email: input.userEmail,
        created_membership: createdMembership,
      });
    if (auditError) {
      if (createdMembership) {
        await admin
          .from("company_memberships")
          .delete()
          .eq("company_id", input.companyId)
          .eq("user_id", input.userId)
          .eq("is_support", true);
      }
      return {
        ok: false,
        reason: isMissingSupportSchema(auditError) ? "migration" : "error",
      };
    }

    if (!(await setActiveCompany(admin, input.userId, input.companyId))) {
      return { ok: false, reason: "error" };
    }
    return {
      ok: true,
      companyId: input.companyId,
      companyName: (company.name as string) ?? "",
    };
  } catch (err) {
    logFailure("open account", err);
    return { ok: false, reason: "error" };
  }
}

/** The switcher: only a company the user belongs to can become active. */
export async function switchActiveCompany(
  admin: SupabaseClient,
  userId: string,
  companyId: string
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("company_memberships")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return false;
    return await setActiveCompany(admin, userId, companyId);
  } catch (err) {
    logFailure("switch company", err);
    return false;
  }
}

/** «Salir»: back to the user's own (non-support) company. null = none to go back to. */
export async function exitSupportMode(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const companies = await listUserCompanies(admin, userId);
  const home = companies.find((c) => !c.isSupport);
  if (!home) return null;
  return (await switchActiveCompany(admin, userId, home.id)) ? home.id : null;
}

export interface SupportOpenRow {
  id: string;
  companyId: string;
  companyName: string;
  userEmail: string | null;
  openedAt: string;
}

/** The last opens (Administración). */
export async function listRecentSupportOpens(
  admin: SupabaseClient,
  limit = 20
): Promise<SupportOpenRow[]> {
  try {
    const { data, error } = await admin
      .from("support_account_opens")
      .select("id, company_id, user_email, opened_at")
      .order("opened_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const rows = data as {
      id: string;
      company_id: string;
      user_email: string | null;
      opened_at: string;
    }[];
    const ids = [...new Set(rows.map((r) => r.company_id))];
    const { data: companies } = ids.length
      ? await admin.from("companies").select("id, name").in("id", ids)
      : { data: [] };
    const names = new Map(
      ((companies ?? []) as { id: string; name: string | null }[]).map((c) => [
        c.id,
        c.name ?? "",
      ])
    );
    return rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: names.get(r.company_id) ?? "",
      userEmail: r.user_email,
      openedAt: r.opened_at,
    }));
  } catch (err) {
    logFailure("list opens", err);
    return [];
  }
}
