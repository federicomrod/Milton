// Who may change kitchen recipe drafts and what they use (ingredients, names,
// prices): the company's owner, admin or manager, and Milton staff. Returns null when allowed, otherwise the Spanish 403.

import { NextResponse } from "next/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenDrafts,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";

export async function kitchenManagerGuard(
  companyId: string,
  userId: string
): Promise<NextResponse | null> {
  const [isMiltonAdmin, membershipRole] = await Promise.all([
    isUserAdminServer(userId),
    loadMembershipRole(companyId, userId),
  ]);
  if (canManageKitchenDrafts({ isMiltonAdmin, membershipRole })) return null;
  return NextResponse.json(
    { error: "No tienes permiso para cambiar esto." },
    { status: 403 }
  );
}
