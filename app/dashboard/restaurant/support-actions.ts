"use server";

// app/dashboard/restaurant/support-actions.ts
//
// Server actions behind Milton support access (migration 072): «Abrir cuenta»
// (Milton admins only), the company switcher and «Salir». Cookie session; the
// person is always the signed-in user, never a client-supplied id; a company
// can only become active when the user belongs to it (or, for «Abrir cuenta»,
// is a Milton admin, which adds the support membership). Never logs more than
// the error name.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedAuthUser,
  getCachedIsMiltonAdmin,
} from "@/lib/restaurant/auth-user";
import {
  exitSupportMode,
  openClientAccount,
  switchActiveCompany,
} from "@/lib/support/support-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupportActionResult =
  | { ok: true; companyName?: string }
  | { ok: false; error: "forbidden" | "company" | "migration" | "failed" };

export async function openClientAccountAction(
  companyId: string
): Promise<SupportActionResult> {
  const user = await getCachedAuthUser();
  if (!user?.id) return { ok: false, error: "forbidden" };
  if (!(await getCachedIsMiltonAdmin(user.id))) {
    return { ok: false, error: "forbidden" };
  }
  if (typeof companyId !== "string" || !UUID_RE.test(companyId)) {
    return { ok: false, error: "company" };
  }
  const result = await openClientAccount(createAdminClient(), {
    userId: user.id,
    userEmail: user.email ?? null,
    companyId,
  });
  if (result.ok) return { ok: true, companyName: result.companyName };
  return {
    ok: false,
    error: result.reason === "error" ? "failed" : result.reason,
  };
}

export async function switchCompanyAction(
  companyId: string
): Promise<SupportActionResult> {
  const user = await getCachedAuthUser();
  if (!user?.id) return { ok: false, error: "forbidden" };
  if (typeof companyId !== "string" || !UUID_RE.test(companyId)) {
    return { ok: false, error: "company" };
  }
  const ok = await switchActiveCompany(createAdminClient(), user.id, companyId);
  return ok ? { ok: true } : { ok: false, error: "failed" };
}

export async function exitSupportAction(): Promise<SupportActionResult> {
  const user = await getCachedAuthUser();
  if (!user?.id) return { ok: false, error: "forbidden" };
  const home = await exitSupportMode(createAdminClient(), user.id);
  return home ? { ok: true } : { ok: false, error: "failed" };
}
