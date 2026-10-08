// lib/restaurant/telegram/kitchen-qr.ts
//
// Create-or-rotate a location's kitchen QR and render it (server only).
// Shared by the client route (owners) and the Milton-admin route. The
// caller has ALREADY authorized the request (canManageKitchenQr); this
// function re-checks that the location belongs to the company and is
// active, then rotates and renders. The raw deep link is returned once.

import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { rotateLocationToken } from "./kitchen-join";

export type CreateKitchenQrResult =
  | {
      ok: true;
      deep_link: string;
      qr_svg: string;
      qr_png_data_url: string;
    }
  | { ok: false; reason: "location_not_found" };

export async function createOrRotateKitchenQr(
  companyId: string,
  locationId: string,
  userId: string
): Promise<CreateKitchenQrResult> {
  const admin = createAdminClient();
  const { data: location } = await admin
    .from("restaurant_locations")
    .select("id, status")
    .eq("id", locationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!location || location.status !== "active") {
    return { ok: false, reason: "location_not_found" };
  }

  const { deepLink } = await rotateLocationToken(companyId, locationId, userId);
  const options = { errorCorrectionLevel: "M" as const, margin: 2 };
  const [qr_svg, qr_png_data_url] = await Promise.all([
    QRCode.toString(deepLink, { ...options, type: "svg" }),
    QRCode.toDataURL(deepLink, { ...options, width: 512 }),
  ]);
  return { ok: true, deep_link: deepLink, qr_svg, qr_png_data_url };
}
