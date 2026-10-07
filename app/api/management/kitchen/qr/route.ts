// app/api/management/kitchen/qr/route.ts
//
// Milton-admin-only kitchen QR management for ANY company (R1 #55).
//   GET  ?company_id= -> per-location QR status (never a token or hash).
//   POST { company_id, location_id } -> create/rotate; the location must
//        belong to that company. The QR is returned once.
// Both handlers are gated by isUserAdminServer(); everyone else gets 403.

import { NextRequest, NextResponse } from "next/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadKitchenQrStatus } from "@/lib/restaurant/telegram/kitchen-join";
import { createOrRotateKitchenQr } from "@/lib/restaurant/telegram/kitchen-qr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const forbidden = () =>
  NextResponse.json({ error: "Forbidden" }, { status: 403 });

export async function GET(req: NextRequest) {
  try {
    if (!(await isUserAdminServer())) return forbidden();
    const companyId = new URL(req.url).searchParams.get("company_id");
    const admin = createAdminClient();
    const { data: companies } = await admin
      .from("companies")
      .select("id, name")
      .order("name", { ascending: true });
    if (!companyId) {
      return NextResponse.json({ companies: companies ?? [], locations: [] });
    }
    if (!UUID_RE.test(companyId)) {
      return NextResponse.json(
        { error: "Invalid company_id" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      companies: companies ?? [],
      locations: await loadKitchenQrStatus(companyId),
    });
  } catch (err) {
    console.error(
      "[kitchen-qr-admin] GET failed:",
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
    if (!(await isUserAdminServer())) return forbidden();
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    if (!user) return forbidden();

    let body: { company_id?: unknown; location_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    if (
      typeof body.company_id !== "string" ||
      !UUID_RE.test(body.company_id) ||
      typeof body.location_id !== "string" ||
      !UUID_RE.test(body.location_id)
    ) {
      return NextResponse.json(
        { error: "Invalid company_id or location_id" },
        { status: 400 }
      );
    }
    const result = await createOrRotateKitchenQr(
      body.company_id,
      body.location_id,
      user.id
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
      "[kitchen-qr-admin] POST failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not create the QR" },
      { status: 500 }
    );
  }
}
