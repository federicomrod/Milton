// app/dashboard/restaurant/menu/page.tsx
//
// Menu & Recipes foundation page. Server component: resolves the
// company, loads the DTO, and renders either the real page or a
// "no company" / "load failed" fallback.

import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { getCachedAuthUser } from "@/lib/restaurant/auth-user";
import { loadCachedPosSalesRows } from "@/lib/restaurant/pos-read-cache";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import {
  fetchMenuRecipesData,
  type MenuRecipesData,
} from "@/lib/restaurant/menu-recipes-server";
import { MenuRecipesPage } from "@/components/restaurant/MenuRecipesPage";
import { ComingSoonPage } from "@/components/restaurant/ComingSoonPage";
import { loadMenuAreaModel } from "@/lib/restaurant/cockpit-page-data";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
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
    const user = await getCachedAuthUser();
    if (!user) return { kind: "no-company" };
    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { kind: "no-company" };
    const pos = await timeCockpitStep("menu-pos", () =>
      loadCachedPosSalesRows(companyId, null)
    );
    const data = await timeCockpitStep("menu-recipes", () =>
      fetchMenuRecipesData(supabase, companyId, {
        posRows: pos.error
          ? undefined
          : pos.rows.map((row) => ({
              raw_item_name: row.raw_item_name,
              quantity: row.quantity,
              gross_revenue: row.gross_revenue,
              net_revenue: row.net_revenue,
              order_id: row.order_id,
              check_id: row.check_id,
              currency: row.currency,
            })),
      })
    );
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
  const [{ lang }, { profitability }, result] = await Promise.all([
    loadRestaurantShellChrome(),
    loadMenuAreaModel(params.location),
    loadMenuRecipes(),
  ]);

  const header = (
    <div className="w-full px-6 lg:px-10 pt-3">
      <OperatingPageHeader title={t(lang, "Menu", "Menú")} lang={lang} />
      <div className="mt-3 mb-4">
        {profitability ? (
          <MenuProfitabilityTab profitability={profitability} lang={lang} />
        ) : (
          <NotAvailableYet
            lang={lang}
            reason={t(
              lang,
              "Recipe costs required",
              "Hacen falta los costos de las recetas"
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
          lang={lang}
          title={t(lang, "Menu & Recipes", "Menú y recetas")}
          icon={BookOpen}
          tagline={t(
            lang,
            "Connect your account to a company to start building menu items and recipes.",
            "Conecta tu cuenta a una empresa para empezar a armar platillos y recetas."
          )}
          description={t(
            lang,
            "This page will load once your account is linked to a company. Until then it can't show your data.",
            "Esta página carga cuando tu cuenta está ligada a una empresa. Hasta entonces no puede mostrar tus datos."
          )}
          planned={[
            t(
              lang,
              "Map uploaded POS items to menu items",
              "Relacionar los platillos del POS con el menú"
            ),
            t(
              lang,
              "Track recipe status (none / draft / active)",
              "Seguir el estado de cada receta (sin receta / borrador / activa)"
            ),
            t(
              lang,
              "Compose recipes from ingredients and prepared components",
              "Armar recetas con ingredientes y componentes preparados"
            ),
          ]}
          related={[
            {
              href: "/dashboard/restaurant",
              label: t(lang, "Back to live sales", "Volver a las ventas"),
            },
            {
              href: "/dashboard/restaurant/upload",
              label: t(lang, "Import POS Sales", "Importar ventas del POS"),
            },
          ]}
        />
      </>
    );
  }
  return (
    <>
      {header}
      <ComingSoonPage
        lang={lang}
        title={t(lang, "Menu & Recipes", "Menú y recetas")}
        icon={BookOpen}
        tagline={t(
          lang,
          "Menu data could not be loaded.",
          "No se pudo cargar el menú."
        )}
        description={t(
          lang,
          "Something went wrong while loading the menu. Refresh the page and try again.",
          "Algo falló al cargar el menú. Recarga la página e inténtalo de nuevo."
        )}
        planned={[
          t(
            lang,
            "Refresh this page and try again",
            "Recarga esta página e inténtalo de nuevo"
          ),
          t(
            lang,
            "If it keeps happening, check that your company is linked",
            "Si sigue pasando, confirma que tu cuenta está ligada a una empresa"
          ),
        ]}
        related={[
          {
            href: "/dashboard/restaurant",
            label: t(lang, "Back to live sales", "Volver a las ventas"),
          },
        ]}
      />
    </>
  );
}
