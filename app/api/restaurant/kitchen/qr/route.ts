// app/api/restaurant/kitchen/qr/route.ts
//
// Kitchen wall-QR management for the caller's company (R1 #55).
//   GET  -> per-location status (has_active_qr, qr_created_at, active cook
//           count) plus can_manage for the caller. Never returns a token
//           or hash.
//   POST { location_id } -> create/rotate the location's QR. Owners and
//           Milton admins only (canManageKitchenQr), otherwise 403. The
//           QR (deep link, SVG, PNG data URL) is returned ONCE — storage is
//           hash-only, so it can never be shown again; a lost sheet means
//           rotating, which stops the old sheet immediately.
// The company always comes from authAndCompany(), never the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenQr,
  loadKitchenQrStatus,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";
import { createOrRotateKitchenQr } from "@/lib/restaurant/telegram/kitchen-qr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function callerCanManage(companyId: string, userId: string) {
  const [isMiltonAdmin, membershipRole] = await Promise.all([
    isUserAdminServer(userId),
    loadMembershipRole(companyId, userId),
  ]);
  return canManageKitchenQr({ isMiltonAdmin, membershipRole });
}

export async function GET() {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;
    const [locations, canManage] = await Promise.all([
      loadKitchenQrStatus(companyId),
      callerCanManage(companyId, userId),
    ]);
    return NextResponse.json({
      can_manage: canManage,
      locations: locations.map((l) => ({ ...l, can_manage: canManage })),
    });
  } catch (err) {
    console.error(
      "[kitchen-qr] GET failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not load kitchen QR status" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;

    const [isMiltonAdmin, membershipRole] = await Promise.all([
      isUserAdminServer(userId),
      loadMembershipRole(companyId, userId),
    ]);
    if (!canManageKitchenQr({ isMiltonAdmin, membershipRole })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { location_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    if (
      typeof body.location_id !== "string" ||
      !UUID_RE.test(body.location_id)
    ) {
      return NextResponse.json(
        { error: "Invalid location_id" },
        { status: 400 }
      );
    }

    const result = await createOrRotateKitchenQr(
      companyId,
      body.location_id,
      userId
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      deep_link: result.deep_link,
      qr_svg: result.qr_svg,
      qr_png_data_url: result.qr_png_data_url,
    });
  } catch (err) {
    console.error(
      "[kitchen-qr] POST failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not create the QR" },
      { status: 500 }
    );
  }
}
