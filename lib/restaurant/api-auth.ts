// lib/restaurant/api-auth.ts
//
// Shared auth + company-resolution helper for restaurant API routes.
// Keeps the route handlers tiny and the company-lookup story consistent
// (same four-step fallback chain as the POS upload route).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { getDictionary } from "@/lib/i18n";
import { requestLanguage } from "@/lib/restaurant/request-lang";

/** Auth-time messages (no company yet): cookie / Accept-Language language. */
async function authMessages() {
  return getDictionary(await requestLanguage()).admin.api;
}

export type AuthAndCompanyResult =
  | { ok: true; supabase: SupabaseClient; companyId: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Resolve the authenticated user + their company.
 *
 * Never accepts a `company_id` from the client — that would be a trivial
 * tenancy bypass. RLS still backs every subsequent query as a second
 * layer of defense.
 */
// R1-09c: one auth + company lookup per request. A page, its layout and
// the loaders it calls share the cached user (getCachedAuthUser) and
// company (getCachedCompanyId) instead of asking Supabase again each time.
export const authAndCompany = cache(authAndCompanyUncached);

async function authAndCompanyUncached(): Promise<AuthAndCompanyResult> {
  const supabase = await createClient();
  const user = await getCachedAuthUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: (await authMessages()).signInAgain },
        { status: 401 }
      ),
    };
  }
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No company resolved for user", user_id: user.id },
        { status: 404 }
      ),
    };
  }
  return { ok: true, supabase, companyId, userId: user.id };
}

// ---------------------------------------------------------------------------
// Bearer auth for the mobile API (/api/mobile/v1, mobile P0b #430)
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** `Authorization: Bearer <token>` -> the token, or null. Never logged. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export type BearerUserResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      userId: string;
      email: string | null;
    }
  | { ok: false; response: NextResponse };

function bearerError(error: string, status: number, extra?: object) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

/**
 * Validates a Supabase access token sent as a bearer (managers and owners in
 * the app). The returned client carries that token, so RLS applies exactly as
 * it does on the web; the service role is never used here.
 */
export async function authUserFromBearer(
  request: Request
): Promise<BearerUserResult> {
  const token = readBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: bearerError((await authMessages()).signInAgain, 401),
    };
  }
  try {
    const supabase = await createClient(undefined, token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return {
        ok: false,
        response: bearerError((await authMessages()).signInAgain, 401),
      };
    }
    return {
      ok: true,
      supabase,
      userId: data.user.id,
      email: data.user.email ?? null,
    };
  } catch (err) {
    console.error(
      "[mobile-auth] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return {
      ok: false,
      response: bearerError((await authMessages()).signInAgain, 401),
    };
  }
}

export type BearerAuthAndCompanyResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      companyId: string;
      userId: string;
      email: string | null;
    }
  | { ok: false; response: NextResponse };

/**
 * Sibling of authAndCompany() for bearer requests. A company may be asked for
 * with `?companyId=` or the `X-Company-Id` header (or opts.companyId), but it
 * is only ever a REQUEST: it must be one of the caller's memberships (read
 * through the caller's own RLS client), else 403. Without it the company is
 * resolved exactly like the cookie path (resolveCompanyIdForUser).
 */
export async function authAndCompanyFromBearer(
  request: Request,
  opts?: { companyId?: string | null }
): Promise<BearerAuthAndCompanyResult> {
  const user = await authUserFromBearer(request);
  if (!user.ok) return user;
  const { supabase, userId, email } = user;

  try {
    const requested =
      opts?.companyId ??
      new URL(request.url).searchParams.get("companyId") ??
      request.headers.get("x-company-id");

    if (requested) {
      if (!UUID_RE.test(requested)) {
        return {
          ok: false,
          response: bearerError((await authMessages()).companyInvalid, 400),
        };
      }
      const { data, error } = await supabase
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", userId)
        .eq("company_id", requested)
        .maybeSingle();
      if (error || !data) {
        return {
          ok: false,
          response: bearerError((await authMessages()).noCompanyAccess, 403),
        };
      }
      return { ok: true, supabase, companyId: requested, userId, email };
    }

    const companyId = await resolveCompanyIdForUser(supabase, userId);
    if (!companyId) {
      return {
        ok: false,
        response: bearerError("No company resolved for user", 404, {
          user_id: userId,
        }),
      };
    }
    return { ok: true, supabase, companyId, userId, email };
  } catch (err) {
    console.error(
      "[mobile-auth] company lookup failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return {
      ok: false,
      response: bearerError((await authMessages()).accountLoadFailed, 500),
    };
  }
}
