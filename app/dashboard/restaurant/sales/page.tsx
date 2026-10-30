// app/dashboard/restaurant/sales/page.tsx
//
// Ventas (R1-17b, mocks 1/2/4; the one Ventas page since Oct 17): explore and
// compare — "why, when, where". The Cockpit is the summary; nothing here repeats
// it in the same form. One request loads the period's data (the cube); the filter
// bar, the three tabs and every click are computed in the browser. The state
// lives in the URL. /sales/detalle forwards here.

import { getDictionary } from "@/lib/i18n";
import { SalesDetailV2 } from "@/components/restaurant/sales/detail/SalesDetailV2";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { parseDetailState } from "@/lib/restaurant/sales-detail";
import { flattenVentasParams } from "@/lib/restaurant/sales-ventas-url";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ lang }, params] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  // Old links (?period=last_7 | month) keep working.
  const flat = flattenVentasParams(params);
  const location = flat.location ?? null;

  return (
    <div className="w-full px-6 py-3 lg:px-10 space-y-2">
      <OperatingPageHeader
        title={getDictionary(lang).sales.page.title}
        lang={lang}
        showDateRange={false}
      />
      <SalesDetailV2
        initial={parseDetailState(flat)}
        locationId={location}
        lang={lang}
      />
    </div>
  );
}
