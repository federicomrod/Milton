// app/api/restaurant/pos/odoo-combo-diagnostics/route.ts
//
// GET /api/restaurant/pos/odoo-combo-diagnostics
//
// Admin/owner-only, strictly READ-ONLY inspection of combo + attribute
// fields on the signed-in user's selected Odoo companies. Reports only;
// it never creates, writes, unlinks, or calls an Odoo action. Missing
// combo fields (older Odoo) are notes, not a 502.
//
// Milton company is resolved server-side by authAndCompany() and is never
// read from the request. Odoo I/O goes through loadOdooSession + the
// scoped helper, which still injects domain and context.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  forbiddenResponse,
  resolveActor,
  type Actor,
} from "@/lib/auth/permissions";
import {
  canAccessOdooComboDiagnostics,
  collectOdooComboDiagnostics,
} from "@/lib/restaurant/odoo/combo-diagnostics";
import { loadOdooSession } from "@/lib/restaurant/odoo/load-connection";
import {
  assertOdooScope,
  OdooCompanyScopeError,
} from "@/lib/restaurant/odoo/scoped";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { OdooRpcError } from "@/lib/restaurant/odoo/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function logOdooFault(tag: string, err: unknown): string {
  const name = err instanceof Error ? err.name : "UnknownError";
  const logMessage = err instanceof Error ? err.message : "Unknown error";
  let statusClass = "unknown";
  if (err instanceof OdooRpcError && typeof err.faultCode === "number") {
    const code = err.faultCode;
    if (Number.isInteger(code) && code >= 100 && code <= 599) {
      statusClass = `${Math.floor(code / 100)}xx`;
    }
  }
  console.error(tag, name, logMessage);
  return statusClass;
}

function odooFaultDetails(statusClass: string): string {
  return `Odoo request failed (${statusClass})`;
}

export async function GET() {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId, userId } = auth;

    let actor: Actor;
    try {
      actor = await resolveActor(supabase, userId, { companyId });
    } catch (err) {
      // The role could not be read: only Milton staff may continue.
      console.error(
        "[Odoo Combo Diagnostics] role",
        err instanceof Error ? err.message : "Unknown error"
      );
      actor = {
        userId,
        companyId,
        role: null,
        isMiltonStaff: await isUserAdminServer(userId),
      };
    }
    if (!canAccessOdooComboDiagnostics(actor)) {
      return forbiddenResponse();
    }

    const session = await loadOdooSession(
      supabase,
      companyId,
      "Odoo Combo Diagnostics"
    );
    if (!session.ok) return session.response;
    const { conn, creds, uid } = session;

    let scope;
    try {
      scope = assertOdooScope(conn.odoo_company_ids);
    } catch (err) {
      if (err instanceof OdooCompanyScopeError) {
        return NextResponse.json(
          {
            error: "odoo_company_selection_required",
            details: odooFaultDetails("unknown"),
          },
          { status: 409 }
        );
      }
      throw err;
    }

    const report = await collectOdooComboDiagnostics(creds, uid, scope);
    return NextResponse.json(report);
  } catch (err) {
    const statusClass = logOdooFault("[Odoo Combo Diagnostics] failed:", err);
    return NextResponse.json(
      {
        error: "Odoo combo diagnostics failed",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }
}
