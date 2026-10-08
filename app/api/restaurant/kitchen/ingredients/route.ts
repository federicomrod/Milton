// app/api/restaurant/kitchen/ingredients/route.ts
//
// GET /api/restaurant/kitchen/ingredients
//
// Returns the company's ingredient catalog for recipe draft matching.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, default_unit")
    .eq("company_id", auth.companyId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[ingredients] list failed:", error.message);
    return NextResponse.json(
      { error: "Could not load ingredients." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingredients: data ?? [] });
}
