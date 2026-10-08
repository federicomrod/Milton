// app/api/restaurant/pos/odoo-connection/route.ts
//
// POST /api/restaurant/pos/odoo-connection
//
// Odoo Production Hardening v1 — the smallest possible write mechanism to
// get an Odoo connection configured for a company: no GET, no listing, no
// settings UI. It exists solely because there would otherwise be no way
// to get a credential into restaurant_pos_secrets at all.
//
// Odoo multi-company isolation: before anything is written, the submitted
// credentials are authenticated against Odoo and the companies the Odoo
// user can access are discovered (res.users -> res.company). The tenant's
// odoo_company_ids selection is then resolved by
// resolveOdooCompanySelection(): auto-selected when exactly one company is
// accessible, explicit (optional body field odoo_company_ids) when several,
// and null (sync refuses, fail closed) until chosen. Inaccessible IDs are
// rejected with 400. Companies can also be chosen later via
// /api/restaurant/pos/odoo-companies.
//
// Behavior:
//   0. Authenticate + discover companies BEFORE writing anything.
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
import {
  storeOdooSecret,
  assertOdooEncryptionConfigured,
  OdooSecretConfigError,
} from "@/lib/restaurant/odoo/secrets";
import {
  authenticate,
  OdooAuthenticationError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import { discoverOdooCompanies } from "@/lib/restaurant/odoo/scoped";
import { resolveOdooCompanySelection } from "@/lib/restaurant/odoo/company-selection";
import {
  assertOdooBaseUrlAllowed,
  parseAllowedHosts,
  OdooHostNotAllowedError,
} from "@/lib/restaurant/odoo/allowed-hosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  base_url?: unknown;
  database_name?: unknown;
  username?: unknown;
  timezone?: unknown;
  api_key?: unknown;
  odoo_company_ids?: unknown;
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

    const rawBaseUrl = requiredString(body.base_url);

    // Extract and validate origin only (reject path/query/fragment)
    let baseUrl: string | null = null;
    if (rawBaseUrl) {
      try {
        const parsed = new URL(rawBaseUrl);
        if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
          return NextResponse.json(
            {
              error:
                "base_url must contain only origin (no path, query, or fragment)",
            },
            { status: 400 }
          );
        }
        baseUrl = parsed.origin;
      } catch {
        return NextResponse.json(
          { error: "base_url is not a valid URL" },
          { status: 400 }
        );
      }
    }

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

    // --- Allowed-hosts guard (SSRF-safe, fail closed) before any network I/O ---
    const allowedHosts = parseAllowedHosts();
    try {
      assertOdooBaseUrlAllowed(baseUrl as string, allowedHosts);
    } catch (err) {
      if (err instanceof OdooHostNotAllowedError) {
        return NextResponse.json(
          { error: "Odoo connection not allowed" },
          { status: 400 }
        );
      }
      throw err;
    }

    // --- Verify encryption key before any DB write ------------------------
    try {
      assertOdooEncryptionConfigured();
    } catch (err) {
      if (err instanceof OdooSecretConfigError) {
        return NextResponse.json(
          { error: "Server configuration error" },
          { status: 500 }
        );
      }
      throw err;
    }

    // --- Authenticate + discover Odoo companies BEFORE writing anything ---
    const creds: OdooCredentials = {
      baseUrl: baseUrl as string,
      database: databaseName as string,
      username: username as string,
      apiKey: apiKey as string,
    };
    let uid: number;
    try {
      uid = await authenticate(creds);
    } catch (err) {
      if (err instanceof OdooAuthenticationError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      console.error(
        "[odoo-connection] Odoo unreachable:",
        err instanceof Error ? err.name : "Unknown error"
      );
      return NextResponse.json(
        { error: "Could not reach Odoo instance" },
        { status: 502 }
      );
    }
    let accessible: { id: number; name: string }[];
    try {
      accessible = (await discoverOdooCompanies(creds, uid)).companies;
    } catch (err) {
      console.error(
        "[odoo-connection] company discovery failed:",
        err instanceof Error ? err.name : "Unknown error"
      );
      return NextResponse.json(
        { error: "Could not read the Odoo user's companies" },
        { status: 502 }
      );
    }

    // --- Non-secret connection metadata: normal RLS-backed client ---------
    const { data: existing, error: lookupError } = await supabase
      .from("restaurant_pos_connections")
      .select(
        "id, base_url, database_name, username, timezone, odoo_company_ids"
      )
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

    // A stored selection only carries over when it points at the same Odoo
    // database — company IDs are meaningless across databases.
    const sameDatabase =
      existing?.base_url === baseUrl &&
      existing?.database_name === databaseName;
    const selection = resolveOdooCompanySelection({
      requested: body.odoo_company_ids,
      accessible,
      existing: sameDatabase
        ? (existing?.odoo_company_ids as number[] | null)
        : null,
    });
    if (!selection.ok) {
      return NextResponse.json(
        {
          error: selection.error,
          accessible_companies: selection.accessible.map((c) => ({
            id: c.id,
            name: c.name,
          })),
        },
        { status: selection.status }
      );
    }

    let connectionId: string;
    const isNewConnection = !existing?.id;
    const previousMetadata = existing
      ? {
          base_url: existing.base_url,
          database_name: existing.database_name,
          username: existing.username,
          timezone: existing.timezone,
          odoo_company_ids: existing.odoo_company_ids,
        }
      : null;

    if (existing?.id) {
      connectionId = existing.id;
      const { error: updateError } = await supabase
        .from("restaurant_pos_connections")
        .update({
          base_url: baseUrl,
          database_name: databaseName,
          username,
          timezone,
          odoo_company_ids: selection.selected,
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
          odoo_company_ids: selection.selected,
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

      // Rollback: if secret storage fails after metadata write, delete the
      // newly inserted connection or revert the update.
      if (isNewConnection) {
        await supabase
          .from("restaurant_pos_connections")
          .delete()
          .eq("id", connectionId);
      } else if (previousMetadata) {
        await supabase
          .from("restaurant_pos_connections")
          .update(previousMetadata)
          .eq("id", connectionId);
      }

      return NextResponse.json(
        { error: "Could not store Odoo credential" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      accessible_companies: accessible.map((c) => ({ id: c.id, name: c.name })),
      selected_company_ids: selection.selected,
      selection_required: selection.selectionRequired,
    });
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
