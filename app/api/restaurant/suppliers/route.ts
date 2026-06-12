// app/api/restaurant/suppliers/route.ts
//
// GET  /api/restaurant/suppliers
//   Returns all suppliers for the company, each enriched with:
//     - ingredient_count (from supplier_ingredients)
//     - latest_cost_date and total_spend (from ingredient_cost_entries)
//
// POST /api/restaurant/suppliers
//   Body: { name, contact_name?, email?, phone?, notes?, address?,
//            payment_terms?, tax_id?, status? }
//   Creates a new supplier.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const [suppliersRes, linksRes, costRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select(
        "id, name, status, contact_name, email, phone, notes, address, payment_terms, tax_id, created_at, updated_at"
      )
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("supplier_ingredients")
      .select("supplier_id, ingredient_id")
      .eq("company_id", companyId),
    supabase
      .from("ingredient_cost_entries")
      .select("supplier_id, cost_date, total_cost")
      .eq("company_id", companyId)
      .not("supplier_id", "is", null),
  ]);

  if (suppliersRes.error) {
    console.error("[suppliers GET]", suppliersRes.error.message);
    return NextResponse.json(
      { error: "Read failed", details: suppliersRes.error.message },
      { status: 500 }
    );
  }

  // Build per-supplier aggregates in memory so we avoid N+1 queries.
  const ingredientCountBySupplierId = new Map<string, number>();
  for (const l of (linksRes.data ?? []) as { supplier_id: string }[]) {
    ingredientCountBySupplierId.set(
      l.supplier_id,
      (ingredientCountBySupplierId.get(l.supplier_id) ?? 0) + 1
    );
  }

  const latestCostDateBySupplierId = new Map<string, string>();
  const totalSpendBySupplierId = new Map<string, number>();
  for (const e of (costRes.data ?? []) as {
    supplier_id: string;
    cost_date: string;
    total_cost: number;
  }[]) {
    const sid = e.supplier_id;
    const prev = latestCostDateBySupplierId.get(sid);
    if (!prev || e.cost_date > prev)
      latestCostDateBySupplierId.set(sid, e.cost_date);
    totalSpendBySupplierId.set(
      sid,
      (totalSpendBySupplierId.get(sid) ?? 0) + (e.total_cost ?? 0)
    );
  }

  const suppliers = (suppliersRes.data ?? []).map(
    (s: Record<string, unknown>) => ({
      ...s,
      ingredient_count: ingredientCountBySupplierId.get(s.id as string) ?? 0,
      latest_cost_date: latestCostDateBySupplierId.get(s.id as string) ?? null,
      total_spend: totalSpendBySupplierId.get(s.id as string) ?? null,
    })
  );

  return NextResponse.json({ suppliers });
}

interface CreateBody {
  name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  address?: unknown;
  payment_terms?: unknown;
  tax_id?: unknown;
  status?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "`name` is required" }, { status: 400 });
  }

  const str = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const status =
    typeof body.status === "string" &&
    ["active", "inactive", "archived"].includes(body.status)
      ? body.status
      : "active";

  const { data, error } = await auth.supabase
    .from("suppliers")
    .insert({
      company_id: auth.companyId,
      name,
      status,
      contact_name: str(body.contact_name),
      email: str(body.email),
      phone: str(body.phone),
      notes: str(body.notes),
      address: str(body.address),
      payment_terms: str(body.payment_terms),
      tax_id: str(body.tax_id),
    })
    .select(
      "id, name, status, contact_name, email, phone, notes, address, payment_terms, tax_id, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "A supplier with that name already exists" },
        { status: 409 }
      );
    }
    console.error("[suppliers POST]", error?.message);
    return NextResponse.json(
      { error: "Create failed", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ supplier: data }, { status: 201 });
}
