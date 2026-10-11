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
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { IngredientsPage } from "@/components/restaurant/IngredientsPage";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { t } from "@/lib/restaurant/language";

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
      companyCurrency: string;
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

    const [ingredients, suppliersRes, companyCurrency] = await Promise.all([
      fetchIngredientLatestCosts(supabase, companyId),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("name", { ascending: true }),
      resolveCompanyCurrency(supabase, companyId),
    ]);

    const suppliers: SupplierOption[] = (
      (suppliersRes.data ?? []) as { id: string; name: string }[]
    ).map((s) => ({ id: s.id, name: s.name }));

    return { kind: "data", ingredients, suppliers, companyCurrency };
  } catch (err) {
    console.error("[/dashboard/restaurant/ingredients] failed:", err);
    return {
      kind: "data",
      ingredients: [],
      suppliers: [],
      companyCurrency: "USD",
    };
  }
}

export default async function IngredientsRoute() {
  const [{ lang }, result] = await Promise.all([
    loadRestaurantShellChrome(),
    loadIngredients(),
  ]);
  if (result.kind === "data") {
    return (
      <IngredientsPage
        ingredients={result.ingredients}
        suppliers={result.suppliers}
        companyCurrency={result.companyCurrency}
        lang={lang}
      />
    );
  }
  return (
    <ComingSoonPage
      lang={lang}
      title={t(lang, "Ingredients", "Ingredientes")}
      icon={Carrot}
      tagline={t(
        lang,
        "Connect your account to a company to start tracking ingredients.",
        "Conecta tu cuenta a una empresa para registrar ingredientes."
      )}
      description={t(
        lang,
        "The Ingredients page loads once your account is linked to a company.",
        "La página de ingredientes carga cuando tu cuenta está ligada a una empresa."
      )}
      planned={[
        t(
          lang,
          "Define each ingredient with default unit and category",
          "Define cada ingrediente con unidad y categoría"
        ),
      ]}
      related={[
        {
          href: "/dashboard/restaurant",
          label: t(lang, "Back to live sales", "Volver a las ventas"),
        },
      ]}
    />
  );
}
