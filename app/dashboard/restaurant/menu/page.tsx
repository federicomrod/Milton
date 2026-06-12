// app/dashboard/restaurant/menu/page.tsx
//
// Menu & Recipes foundation page. Server component: resolves the
// company, loads the DTO, and renders either the real page or a
// "no company" / "load failed" fallback.

import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  fetchMenuRecipesData,
  type MenuRecipesData,
} from "@/lib/restaurant/menu-recipes-server";
import { MenuRecipesPage } from "@/components/restaurant/MenuRecipesPage";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";

export const dynamic = "force-dynamic";

type LoadResult =
  | { kind: "data"; data: MenuRecipesData }
  | { kind: "no-company" }
  | { kind: "error" };

async function loadMenuRecipes(): Promise<LoadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { kind: "no-company" };
    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { kind: "no-company" };
    const data = await fetchMenuRecipesData(supabase, companyId);
    return { kind: "data", data };
  } catch (err) {
    console.error("[/dashboard/restaurant/menu] failed:", err);
    return { kind: "error" };
  }
}

export default async function MenuRecipesRoute() {
  const result = await loadMenuRecipes();

  if (result.kind === "data") {
    return <MenuRecipesPage data={result.data} />;
  }
  if (result.kind === "no-company") {
    return (
      <ComingSoonPage
        title="Menu & Recipes"
        icon={BookOpen}
        tagline="Connect your account to a company to start building menu items and recipes."
        description="The Menu & Recipes foundation will load once your account is linked to a company. Until then this page can't show your data."
        planned={[
          "Map uploaded POS items to canonical menu items",
          "Track recipe status (none / draft / active)",
          "Compose recipes from ingredients AND prepared components",
        ]}
        related={[
          { href: "/dashboard/restaurant", label: "Back to live sales" },
          { href: "/dashboard/restaurant/upload", label: "Import POS Sales" },
        ]}
      />
    );
  }
  return (
    <ComingSoonPage
      title="Menu & Recipes"
      icon={BookOpen}
      tagline="Menu data could not be loaded."
      description="The Menu & Recipes foundation hit an error while loading. Check Supabase connectivity and refresh."
      planned={[
        "If you just ran the 004 migration, refresh this page",
        "Verify pos_item_mappings, prepared_components, menu_recipe_inputs exist",
      ]}
      related={[{ href: "/dashboard/restaurant", label: "Back to live sales" }]}
    />
  );
}
