// app/dashboard/restaurant/menu/[id]/page.tsx
//
// Menu item detail + recipe builder.

import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { RecipeBuilder } from "@/components/restaurant/RecipeBuilder";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";

export const dynamic = "force-dynamic";

interface MenuItemRow {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  currency: string | null;
  status: string | null;
}

interface RecipeRow {
  id: string;
  status: string | null;
  serving_quantity: number | null;
  serving_unit: string | null;
  notes: string | null;
}

interface InputRow {
  id: string;
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

interface IngredientOption {
  id: string;
  name: string;
  default_unit: string | null;
}

interface ComponentOption {
  id: string;
  name: string;
  output_unit: string;
  status: string;
}

type LoadResult =
  | {
      kind: "data";
      menuItem: MenuItemRow;
      recipe: RecipeRow | null;
      inputs: InputRow[];
      ingredients: IngredientOption[];
      components: ComponentOption[];
    }
  | { kind: "no-company" }
  | { kind: "not-found" }
  | { kind: "error" };

async function loadMenuItem(menuItemId: string): Promise<LoadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { kind: "no-company" };
    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { kind: "no-company" };

    const [menuItemRes, recipeRes, ingredientsRes, componentsRes] =
      await Promise.all([
        supabase
          .from("menu_items")
          .select("id, name, category, selling_price, currency, status")
          .eq("company_id", companyId)
          .eq("id", menuItemId)
          .maybeSingle(),
        supabase
          .from("recipes")
          .select("id, status, serving_quantity, serving_unit, notes")
          .eq("company_id", companyId)
          .eq("menu_item_id", menuItemId)
          .maybeSingle(),
        supabase
          .from("ingredients")
          .select("id, name, default_unit")
          .eq("company_id", companyId)
          .order("name", { ascending: true }),
        supabase
          .from("prepared_components")
          .select("id, name, output_unit, status")
          .eq("company_id", companyId)
          .neq("status", "archived")
          .order("name", { ascending: true }),
      ]);

    const menuItem = menuItemRes.data as MenuItemRow | null;
    if (!menuItem) return { kind: "not-found" };

    const recipe = (recipeRes.data ?? null) as RecipeRow | null;

    let inputs: InputRow[] = [];
    if (recipe) {
      const { data } = await supabase
        .from("menu_recipe_inputs")
        .select(
          "id, input_type, ingredient_id, component_id, quantity, unit, notes"
        )
        .eq("company_id", companyId)
        .eq("recipe_id", recipe.id);
      inputs = (data ?? []) as InputRow[];
    }

    return {
      kind: "data",
      menuItem,
      recipe,
      inputs,
      ingredients: (ingredientsRes.data ?? []) as IngredientOption[],
      components: (componentsRes.data ?? []) as ComponentOption[],
    };
  } catch (err) {
    console.error("[menu/[id]] failed:", err);
    return { kind: "error" };
  }
}

export default async function MenuItemDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: menuItemId } = await params;
  const result = await loadMenuItem(menuItemId);

  if (result.kind === "not-found") return notFound();

  if (result.kind === "data") {
    return (
      <RecipeBuilder
        menuItem={result.menuItem}
        recipe={result.recipe}
        inputs={result.inputs}
        ingredients={result.ingredients}
        components={result.components}
      />
    );
  }
  if (result.kind === "no-company") {
    return (
      <ComingSoonPage
        title="Menu item"
        icon={BookOpen}
        tagline="Connect your account to a company to edit recipes."
        description="The recipe builder loads once your account is linked to a company."
        planned={[]}
        related={[
          { href: "/dashboard/restaurant/menu", label: "Back to Menu" },
        ]}
      />
    );
  }
  return (
    <ComingSoonPage
      title="Menu item"
      icon={BookOpen}
      tagline="Could not load this menu item."
      description="The detail page hit an error. If you just ran migration 004, refresh the page."
      planned={[]}
      related={[{ href: "/dashboard/restaurant/menu", label: "Back to Menu" }]}
    />
  );
}
