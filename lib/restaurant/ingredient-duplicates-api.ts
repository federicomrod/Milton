// R1-15k: shared by the duplicate-ingredient routes: who may, and what a
// database error means for the person.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { actionableError } from "@/lib/restaurant/actionable-error";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function gate() {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "ingredients.manage", {
    message: "Tu rol no puede unir ni descartar ingredientes.",
  });
  if (denied) return { ok: false as const, response: denied };
  return { ok: true as const, auth };
}

export function failureResponse(
  error: { code?: string; message?: string },
  fallback: string,
  tag: string
) {
  const code = error.code;
  // The function or table is missing: 051 (or 050) is not applied yet.
  if (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42P01" ||
    code === "42703"
  ) {
    return NextResponse.json(
      {
        unavailable: true,
        error: "Falta aplicar las migraciones 050 y 051 en este ambiente.",
      },
      { status: 409 }
    );
  }
  if (code === "22023") {
    return NextResponse.json(
      { error: error.message ?? fallback },
      { status: 400 }
    );
  }
  const failure = actionableError(error, fallback, tag);
  return NextResponse.json(
    { error: failure.message, ref: failure.ref },
    { status: failure.status }
  );
}
