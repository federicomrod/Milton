// app/dashboard/restaurant/suppliers/page.tsx
//
// Server Component: fetches enriched supplier list and hands it to
// the client SuppliersPage component.
//
// Auth: uses the same createClient + resolveCompanyIdForUser pattern
// as the Ingredients and Menu pages — the multi-step lookup tries
// companies.created_by → profiles.id → profiles.user_id → company_memberships.

import { Carrot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  SuppliersPage,
  type SupplierRow,
} from "@/components/restaurant/SuppliersPage";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";

export const dynamic = "force-dynamic";

export default async function SuppliersRoute() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <ComingSoonPage
        title="Suppliers"
        icon={Carrot}
        tagline="Sign in to manage your suppliers."
        description=""
        planned={[]}
        related={[]}
      />
    );
  }

  const companyId = await resolveCompanyIdForUser(supabase, user.id);

  if (!companyId) {
    return (
      <ComingSoonPage
        title="Suppliers"
        icon={Carrot}
        tagline="No company found for your account."
        description="Your account isn't linked to a company yet."
        planned={[]}
        related={[{ href: "/dashboard/restaurant", label: "Back to cockpit" }]}
      />
    );
  }

  // Suppliers: try the full column set first. If migration 007 hasn't
  // been applied yet, the extended columns (contact_name, email, …) don't
  // exist and the whole select errors — returning zero rows even though
  // suppliers exist. Fall back to the always-present columns so the page
  // still lists suppliers; the missing fields just render as "—".
  const FULL_COLS =
    "id, name, status, contact_name, email, phone, notes, address, payment_terms, tax_id, created_at, updated_at";
  const MINIMAL_COLS = "id, name, status";

  const fullRes = await supabase
    .from("suppliers")
    .select(FULL_COLS)
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  let supplierRows: Record<string, unknown>[] = (fullRes.data ?? []) as Record<
    string,
    unknown
  >[];

  if (fullRes.error) {
    console.error(
      "[suppliers page] full select failed, falling back to minimal columns:",
      fullRes.error.message
    );
    const minimalRes = await supabase
      .from("suppliers")
      .select(MINIMAL_COLS)
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (minimalRes.error) {
      console.error(
        "[suppliers page] minimal select also failed:",
        minimalRes.error.message
      );
    }
    supplierRows = (minimalRes.data ?? []) as Record<string, unknown>[];
  }

  // Metrics are best-effort: if either query fails (e.g. table missing),
  // we still render suppliers and degrade the metric to "—".
  const [linksRes, costRes] = await Promise.all([
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

  if (linksRes.error) {
    console.error(
      "[suppliers page] supplier_ingredients:",
      linksRes.error.message
    );
  }
  if (costRes.error) {
    console.error(
      "[suppliers page] ingredient_cost_entries:",
      costRes.error.message
    );
  }

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

  const suppliers: SupplierRow[] = supplierRows.map((s) => ({
    id: s.id as string,
    name: s.name as string,
    status: (s.status as string) ?? "active",
    contact_name: (s.contact_name as string | null) ?? null,
    email: (s.email as string | null) ?? null,
    phone: (s.phone as string | null) ?? null,
    notes: (s.notes as string | null) ?? null,
    address: (s.address as string | null) ?? null,
    payment_terms: (s.payment_terms as string | null) ?? null,
    tax_id: (s.tax_id as string | null) ?? null,
    ingredient_count: ingredientCountBySupplierId.get(s.id as string) ?? 0,
    latest_cost_date: latestCostDateBySupplierId.get(s.id as string) ?? null,
    total_spend: totalSpendBySupplierId.get(s.id as string) ?? null,
  }));

  return <SuppliersPage suppliers={suppliers} />;
}
