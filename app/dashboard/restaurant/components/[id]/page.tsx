// app/dashboard/restaurant/components/[id]/page.tsx
//
// Component recipe builder. Mirrors the menu-item recipe page exactly —
// same input shape, same "replace inputs on save" contract, same option
// dropdowns. The only differences are:
//   * header is the component (name + output unit), not a menu item
//   * the recipe header has output_quantity + output_unit + yield_percentage
//   * saves go to PUT /api/restaurant/recipes/component/:id

import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { ComponentRecipeBuilder } from "@/components/restaurant/ComponentRecipeBuilder";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";
import { fetchMenuRecipesData } from "@/lib/restaurant/menu-recipes-server";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { t } from "@/lib/restaurant/language";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";

export const dynamic = "force-dynamic";

interface ComponentRow {
  id: string;
  name: string;
  category: string | null;
  output_unit: string;
  status: string | null;
}

interface RecipeRow {
  id: string;
  name: string | null;
  output_quantity: number | null;
  output_unit: string | null;
  yield_percentage: number | null;
  status: string | null;
  source_type?: string | null;
  workbook_cost_total?: number | null;
  workbook_computed_cost?: number | null;
  workbook_cost_match?: "match" | "mismatch" | null;
  workbook_variance_amount?: number | null;
  workbook_variance_pct?: number | null;
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
      component: ComponentRow;
      recipe: RecipeRow | null;
      inputs: InputRow[];
      ingredients: IngredientOption[];
      components: ComponentOption[];
      cost: import("@/types/restaurant-costing").ComponentCostResult | null;
    }
  | { kind: "no-company" }
  | { kind: "not-found" }
  | { kind: "error" };

async function loadComponent(componentId: string): Promise<LoadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { kind: "no-company" };
    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { kind: "no-company" };

    const [componentRes, recipeRes, ingredientsRes, componentsRes] =
      await Promise.all([
        supabase
          .from("prepared_components")
          .select("id, name, category, output_unit, status")
          .eq("company_id", companyId)
          .eq("id", componentId)
          .maybeSingle(),
        (async () => {
          const full = await supabase
            .from("component_recipes")
            .select(
              "id, name, output_quantity, output_unit, yield_percentage, status, source_type, workbook_cost_total, workbook_computed_cost, workbook_cost_match, workbook_variance_amount, workbook_variance_pct"
            )
            .eq("company_id", companyId)
            .eq("component_id", componentId)
            .maybeSingle();
          if (
            full.error &&
            errorMentionsColumn(full.error, "workbook_cost_total")
          ) {
            return supabase
              .from("component_recipes")
              .select(
                "id, name, output_quantity, output_unit, yield_percentage, status, source_type"
              )
              .eq("company_id", companyId)
              .eq("component_id", componentId)
              .maybeSingle();
          }
          return full;
        })(),
        supabase
          .from("ingredients")
          .select("id, name, default_unit")
          .eq("company_id", companyId)
          .order("name", { ascending: true }),
        supabase
          .from("prepared_components")
          .select("id, name, output_unit, status")
          .eq("company_id", companyId)
          // Hide archived AND the current component itself — a component
          // recipe can't consume itself; the engine catches deeper cycles.
          .neq("status", "archived")
          .neq("id", componentId)
          .order("name", { ascending: true }),
      ]);

    const component = componentRes.data as ComponentRow | null;
    if (!component) return { kind: "not-found" };
    const recipe = (recipeRes.data ?? null) as RecipeRow | null;

    let inputs: InputRow[] = [];
    if (recipe) {
      const { data } = await supabase
        .from("component_recipe_inputs")
        .select(
          "id, input_type, ingredient_id, component_id, quantity, unit, notes"
        )
        .eq("company_id", companyId)
        .eq("component_recipe_id", recipe.id);
      inputs = (data ?? []) as InputRow[];
    }

    const catalog = await fetchMenuRecipesData(supabase, companyId, {
      posRows: [],
    });
    const cost =
      catalog.components.find((row) => row.id === component.id)?.cost ?? null;

    return {
      kind: "data",
      component,
      recipe,
      inputs,
      ingredients: (ingredientsRes.data ?? []) as IngredientOption[],
      components: (componentsRes.data ?? []) as ComponentOption[],
      cost,
    };
  } catch (err) {
    console.error("[components/[id]] failed:", err);
    return { kind: "error" };
  }
}

export default async function ComponentRecipeRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ lang }, result] = await Promise.all([
    loadRestaurantShellChrome(),
    loadComponent(id),
  ]);

  if (result.kind === "not-found") return notFound();

  if (result.kind === "data") {
    return (
      <ComponentRecipeBuilder
        component={result.component}
        recipe={result.recipe}
        inputs={result.inputs}
        ingredients={result.ingredients}
        components={result.components}
        lang={lang}
        cost={result.cost}
        workbook={
          result.recipe
            ? {
                excel_cost: result.recipe.workbook_cost_total ?? null,
                milton_cost: result.recipe.workbook_computed_cost ?? null,
                match: result.recipe.workbook_cost_match ?? null,
                source_type: result.recipe.source_type ?? null,
                variance_amount: result.recipe.workbook_variance_amount ?? null,
                variance_pct: result.recipe.workbook_variance_pct ?? null,
              }
            : null
        }
      />
    );
  }
  return (
    <ComingSoonPage
      lang={lang}
      title={t(lang, "Component", "Sub-receta")}
      icon={Sparkles}
      tagline={
        result.kind === "no-company"
          ? t(
              lang,
              "Connect your account to a company to edit component recipes.",
              "Conecta tu cuenta a una empresa para editar sub-recetas."
            )
          : t(
              lang,
              "Could not load this component.",
              "No se pudo cargar esta sub-receta."
            )
      }
      description={t(
        lang,
        "The component recipe builder loads once your account is linked to a company.",
        "El editor de sub-recetas carga cuando tu cuenta está ligada a una empresa."
      )}
      planned={[]}
      related={[
        {
          href: "/dashboard/restaurant/menu",
          label: t(lang, "Back to Menu", "Volver al menú"),
        },
      ]}
    />
  );
}
