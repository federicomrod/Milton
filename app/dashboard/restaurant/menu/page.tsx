// app/dashboard/restaurant/menu/page.tsx
//
// Menú › Resumen: profitability. Recetas y costeo lives at /menu/recetas.

import { loadMenuAreaModel } from "@/lib/restaurant/cockpit-page-data";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { MenuProfitabilityTab } from "@/components/restaurant/cockpit/MenuProfitabilityTab";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { t } from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";

export default async function MenuRecipesRoute({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const params = await searchParams;
  const [{ lang }, { profitability }] = await Promise.all([
    loadRestaurantShellChrome(),
    loadMenuAreaModel(params.location),
  ]);

  return (
    <div>
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
            href="/dashboard/restaurant/menu/recetas"
            linkLabel={t(lang, "Upload cost file →", "Subir Excel de costos →")}
          />
        )}
      </div>
    </div>
  );
}
