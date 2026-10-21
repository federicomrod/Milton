// Who may connect or disconnect the company's Telegram chat: the company's
// owner or admin members only (company_memberships.role). Viewers, analysts,
// managers and plain members can read the status but not change it.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyMembershipRole } from "@/lib/restaurant/cost-workbook/reset-auth";

export function canManageTelegram(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export const TELEGRAM_FORBIDDEN_MESSAGE =
  "Solo el dueño o un administrador de la empresa puede conectar o desconectar Telegram.";

/** null = allowed; otherwise the 403 (or 500 when the role cannot be read). */
export async function telegramManagerGuard(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<NextResponse | null> {
  try {
    const { role } = await loadCompanyMembershipRole(
      supabase,
      companyId,
      userId
    );
    if (canManageTelegram(role)) return null;
  } catch (err) {
    console.error(
      "[telegram-access] role lookup failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude comprobar tus permisos." },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { error: TELEGRAM_FORBIDDEN_MESSAGE },
    { status: 403 }
  );
}
