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
import { loadCockpitPageModel } from "@/lib/restaurant/cockpit-page-data";
import { MenuProfitabilityTab } from "@/components/restaurant/cockpit/MenuProfitabilityTab";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { t } from "@/lib/restaurant/language";

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

export default async function MenuRecipesRoute({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const params = await searchParams;
  const { data, profitability } = await loadCockpitPageModel(params.location);
  const lang = data.mode === "live" ? data.preferredLanguage : "en";
  const result = await loadMenuRecipes();

  const header = (
    <div className="w-full px-6 lg:px-10 pt-3">
      <OperatingPageHeader title={t(lang, "Menu", "Menú")} lang={lang} />
      <div className="mt-3 mb-4">
        {profitability ? (
          <MenuProfitabilityTab profitability={profitability} />
        ) : (
          <NotAvailableYet
            lang={lang}
            reason={t(
              lang,
              "Recipe costs required",
              "Se requieren costos de receta"
            )}
            href="/dashboard/restaurant/costs/upload"
            linkLabel={t(lang, "Add costs →", "Agregar costos →")}
          />
        )}
      </div>
    </div>
  );

  if (result.kind === "data") {
    return (
      <>
        {header}
        <MenuRecipesPage data={result.data} />
      </>
    );
  }
  if (result.kind === "no-company") {
    return (
      <>
        {header}
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
      </>
    );
  }
  return (
    <>
      {header}
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
    </>
  );
}
