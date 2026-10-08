// app/api/admin/odoo/location-mapping/route.ts
//
// Admin-only: GET loads current Odoo company → location mapping for a workspace,
// POST updates the mapping after validation.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserAdminServer } from "@/lib/profile-service-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json(
      { error: "company_id query parameter is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { data: locations, error } = await adminClient
    .from("restaurant_locations")
    .select("id, name, odoo_company_id")
    .eq("company_id", companyId)
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: "Failed to load locations" },
      { status: 500 }
    );
  }

  return NextResponse.json({ locations });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    company_id?: unknown;
    mappings?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const companyId =
    typeof body.company_id === "string" && body.company_id.trim()
      ? body.company_id.trim()
      : null;

  if (!companyId) {
    return NextResponse.json(
      { error: "company_id is required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.mappings)) {
    return NextResponse.json(
      { error: "mappings must be an array" },
      { status: 400 }
    );
  }

  const mappings = body.mappings as {
    odoo_company_id?: unknown;
    location_id?: unknown;
  }[];

  // Validate mappings format
  for (const m of mappings) {
    if (
      typeof m.odoo_company_id !== "number" ||
      typeof m.location_id !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Each mapping must have odoo_company_id (number) and location_id (string)",
        },
        { status: 400 }
      );
    }
  }

  const adminClient = createAdminClient();

  // Load connection to validate odoo_company_ids
  const { data: connection, error: connError } = await adminClient
    .from("restaurant_pos_connections")
    .select("odoo_company_ids")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .maybeSingle();

  if (connError) {
    return NextResponse.json(
      { error: "Failed to load connection" },
      { status: 500 }
    );
  }

  if (!connection) {
    return NextResponse.json(
      { error: "No Odoo connection configured" },
      { status: 404 }
    );
  }

  const selectedCompanyIds = (connection.odoo_company_ids || []) as number[];

  // Validate all mappings
  const mappedOdooCompanyIds = new Set<number>();
  const mappedLocationIds = new Set<string>();

  for (const m of mappings) {
    const odooCompanyId = m.odoo_company_id as number;
    const locationId = m.location_id as string;

    // Check Odoo company is in selected list
    if (!selectedCompanyIds.includes(odooCompanyId)) {
      return NextResponse.json(
        { error: `Odoo company ${odooCompanyId} is not in selected companies` },
        { status: 400 }
      );
    }

    // Check no duplicate Odoo company
    if (mappedOdooCompanyIds.has(odooCompanyId)) {
      return NextResponse.json(
        { error: `Odoo company ${odooCompanyId} is mapped multiple times` },
        { status: 400 }
      );
    }
    mappedOdooCompanyIds.add(odooCompanyId);

    // Check no duplicate location
    if (mappedLocationIds.has(locationId)) {
      return NextResponse.json(
        { error: `Location ${locationId} is mapped multiple times` },
        { status: 400 }
      );
    }
    mappedLocationIds.add(locationId);
  }

  // Verify all locations belong to this company
  const { data: locations, error: locError } = await adminClient
    .from("restaurant_locations")
    .select("id")
    .eq("company_id", companyId)
    .in("id", Array.from(mappedLocationIds));

  if (locError) {
    return NextResponse.json(
      { error: "Failed to verify locations" },
      { status: 500 }
    );
  }

  if (locations.length !== mappedLocationIds.size) {
    return NextResponse.json(
      { error: "One or more locations do not belong to this company" },
      { status: 400 }
    );
  }

  // Clear all existing mappings for this company first
  const { error: clearError } = await adminClient
    .from("restaurant_locations")
    .update({ odoo_company_id: null })
    .eq("company_id", companyId);

  if (clearError) {
    return NextResponse.json(
      { error: "Failed to clear existing mappings" },
      { status: 500 }
    );
  }

  // Apply new mappings
  for (const m of mappings) {
    const { error: updateError } = await adminClient
      .from("restaurant_locations")
      .update({ odoo_company_id: m.odoo_company_id as number })
      .eq("id", m.location_id as string)
      .eq("company_id", companyId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update mapping" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
