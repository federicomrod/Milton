// app/api/restaurant/pos/odoo-connection/route.ts
//
// POST /api/restaurant/pos/odoo-connection
//
// Odoo Production Hardening v1 — the smallest possible write mechanism to
// get an Odoo connection configured for a company: no GET, no listing, no
// settings UI. It exists solely because there would otherwise be no way
// to get a credential into restaurant_pos_secrets at all.
//
// Behavior:
//   1. authAndCompany() — company_id is resolved server-side, never
//      accepted from the request body, same pattern as every other
//      restaurant route.
//   2. Non-secret connection metadata (base_url, database_name, username,
//      timezone) is written to restaurant_pos_connections via the normal
//      RLS-backed client — retry-safe insert-if-missing/update-if-exists,
//      same idiom as onboarding/complete and add-restaurant.
//   3. The Odoo API key is encrypted immediately and written to
//      restaurant_pos_secrets via lib/restaurant/odoo/secrets.ts's
//      storeOdooSecret(), which uses the service-role client — the only
//      client that table's RLS allows.
//
// SECURITY: the API key is NEVER echoed back in the response, NEVER
// logged (see storeOdooSecret's own guarantees), and NEVER written
// anywhere except the encrypted column.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { storeOdooSecret } from "@/lib/restaurant/odoo/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  base_url?: unknown;
  database_name?: unknown;
  username?: unknown;
  timezone?: unknown;
  api_key?: unknown;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }

    const baseUrl = requiredString(body.base_url)?.replace(/\/+$/, "") ?? null;
    const databaseName = requiredString(body.database_name);
    const username = requiredString(body.username);
    const timezone = requiredString(body.timezone);
    const apiKey = requiredString(body.api_key);

    const missing: string[] = [];
    if (!baseUrl) missing.push("base_url");
    if (!databaseName) missing.push("database_name");
    if (!username) missing.push("username");
    if (!timezone) missing.push("timezone");
    if (!apiKey) missing.push("api_key");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // --- Non-secret connection metadata: normal RLS-backed client ---------
    const { data: existing, error: lookupError } = await supabase
      .from("restaurant_pos_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("pos_source", "odoo")
      .maybeSingle();
    if (lookupError) {
      console.error(
        "[odoo-connection] connection lookup failed:",
        lookupError.message
      );
      return NextResponse.json(
        {
          error: "Could not save Odoo connection",
          details: lookupError.message,
        },
        { status: 500 }
      );
    }

    let connectionId: string;
    if (existing?.id) {
      connectionId = existing.id;
      const { error: updateError } = await supabase
        .from("restaurant_pos_connections")
        .update({
          base_url: baseUrl,
          database_name: databaseName,
          username,
          timezone,
          is_active: true,
        })
        .eq("id", connectionId);
      if (updateError) {
        console.error(
          "[odoo-connection] connection update failed:",
          updateError.message
        );
        return NextResponse.json(
          {
            error: "Could not save Odoo connection",
            details: updateError.message,
          },
          { status: 500 }
        );
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("restaurant_pos_connections")
        .insert({
          company_id: companyId,
          pos_source: "odoo",
          base_url: baseUrl,
          database_name: databaseName,
          username,
          timezone,
          is_active: true,
        })
        .select("id")
        .single();
      if (insertError || !inserted?.id) {
        console.error(
          "[odoo-connection] connection insert failed:",
          insertError?.message
        );
        return NextResponse.json(
          {
            error: "Could not save Odoo connection",
            details: insertError?.message,
          },
          { status: 500 }
        );
      }
      connectionId = inserted.id;
    }

    // --- Secret: encrypted immediately, written via the service-role
    // client only (restaurant_pos_secrets has no policy for any other
    // role). Never returned, never logged. ---------------------------------
    try {
      // `apiKey` is validated non-null above; the `missing` check already
      // returned if it wasn't.
      await storeOdooSecret(connectionId, companyId, apiKey as string);
    } catch (err) {
      // Deliberately logs only the error's name (e.g. "OdooSecretConfigError"),
      // never its message or the credential itself — this is the closest
      // call site to the plaintext credential in the whole request, so it
      // gets the most conservative treatment even server-side.
      console.error(
        "[odoo-connection] secret storage failed:",
        err instanceof Error ? err.name : "Unknown error"
      );
      return NextResponse.json(
        {
          error:
            "Connection details were saved, but the credential could not be stored. Please try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[odoo-connection] Unexpected error:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not save Odoo connection" },
      { status: 500 }
    );
  }
}
