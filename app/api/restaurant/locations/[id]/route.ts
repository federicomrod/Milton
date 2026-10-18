// PATCH /api/restaurant/locations/:id
//   { name: string }        rename the restaurant
//   { archived: boolean }   archive / restore it (migration 055)
//
// Company and user come from auth, never from the body; the restaurant must be
// one of the caller's company (a foreign or unknown id is a 404, it never
// reveals whether the id exists elsewhere). Renaming validates the name (1–80
// trimmed characters, unique in the company); RLS backs the write. Archiving is
// restaurant_set_archived (42501 for a non-member, 22023 for the last active
// restaurant) and says «falta aplicar la migración 055» before it is applied.

import { revalidateSales } from "@/lib/restaurant/cache-tags";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { validateRestaurantName } from "@/lib/restaurant/restaurant-name";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id))
    return NextResponse.json(
      { error: "Restaurante no encontrado." },
      { status: 404 }
    );

  let body: { name?: unknown; archived?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }

  // The restaurants of the caller's company (RLS scopes this read as well).
  const { data: rows, error: readError } = await auth.supabase
    .from("restaurant_locations")
    .select("id, name")
    .eq("company_id", auth.companyId);
  if (readError) {
    return NextResponse.json(
      { error: "No pude leer tus restaurantes." },
      { status: 500 }
    );
  }
  const all = (rows ?? []) as Array<{ id: string; name: string }>;
  if (!all.some((r) => r.id === id)) {
    return NextResponse.json(
      { error: "Restaurante no encontrado." },
      { status: 404 }
    );
  }

  if (typeof body.archived === "boolean") {
    const { error } = await auth.supabase.rpc("restaurant_set_archived", {
      p_company_id: auth.companyId,
      p_location_id: id,
      p_archived: body.archived,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42501")
        return NextResponse.json(
          { error: "Tu rol no puede archivar restaurantes." },
          { status: 403 }
        );
      if (code === "22023")
        return NextResponse.json({ error: error.message }, { status: 400 });
      if (
        code === "PGRST202" ||
        code === "42883" ||
        /restaurant_set_archived/.test(error.message)
      ) {
        return NextResponse.json(
          {
            error:
              "Falta aplicar la migración 055 en este ambiente: todavía no se puede archivar.",
          },
          { status: 409 }
        );
      }
      console.error("[locations] archive failed:", error.message);
      return NextResponse.json(
        { error: "No pude archivar el restaurante." },
        { status: 500 }
      );
    }
    revalidateSales(auth.companyId);
    return NextResponse.json({ archived: body.archived });
  }

  const check = validateRestaurantName(
    body.name,
    all.filter((r) => r.id !== id).map((r) => r.name)
  );
  if (!check.ok)
    return NextResponse.json({ error: check.message }, { status: 400 });
  const { error } = await auth.supabase
    .from("restaurant_locations")
    .update({ name: check.name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", auth.companyId);
  if (error) {
    console.error("[locations] rename failed:", error.message);
    return NextResponse.json(
      { error: "No pude guardar el nombre." },
      { status: 500 }
    );
  }
  revalidateSales(auth.companyId);
  return NextResponse.json({ id, name: check.name });
}
