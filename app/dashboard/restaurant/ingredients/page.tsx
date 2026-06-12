// app/dashboard/restaurant/ingredients/page.tsx
//
// Foundation page for raw ingredients + latest cost surface.
//
// The page loads ingredients with their latest cost via
// fetchIngredientLatestCosts (same engine helper the menu page uses to
// derive component / menu costs), so what the user sees here is exactly
// what downstream cost calcs will consume.

import { Carrot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  fetchIngredientLatestCosts,
  type IngredientLatestCostRow,
} from "@/lib/restaurant/menu-recipes-server";
import { IngredientsPage } from "@/components/restaurant/IngredientsPage";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";

export const dynamic = "force-dynamic";

interface SupplierOption {
  id: string;
  name: string;
}

type LoadResult =
  | {
      kind: "data";
      ingredients: IngredientLatestCostRow[];
      suppliers: SupplierOption[];
    }
  | { kind: "no-company" };

async function loadIngredients(): Promise<LoadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { kind: "no-company" };
    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { kind: "no-company" };

    const [ingredients, suppliersRes] = await Promise.all([
      fetchIngredientLatestCosts(supabase, companyId),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("name", { ascending: true }),
    ]);

    const suppliers: SupplierOption[] = (
      (suppliersRes.data ?? []) as { id: string; name: string }[]
    ).map((s) => ({ id: s.id, name: s.name }));

    return { kind: "data", ingredients, suppliers };
  } catch (err) {
    console.error("[/dashboard/restaurant/ingredients] failed:", err);
    return { kind: "data", ingredients: [], suppliers: [] };
  }
}

export default async function IngredientsRoute() {
  const result = await loadIngredients();
  if (result.kind === "data") {
    return (
      <IngredientsPage
        ingredients={result.ingredients}
        suppliers={result.suppliers}
      />
    );
  }
  return (
    <ComingSoonPage
      title="Ingredients"
      icon={Carrot}
      tagline="Connect your account to a company to start tracking ingredients."
      description="The Ingredients foundation will load once your account is linked to a company."
      planned={[
        "Define each ingredient with default unit and category",
        "Connect ingredients to suppliers (next milestone)",
        "Use ingredients as inputs to both prepared components and menu recipes",
      ]}
      related={[{ href: "/dashboard/restaurant", label: "Back to live sales" }]}
    />
  );
}
