// app/dashboard/restaurant/sales/detalle/page.tsx
//
// Ventas › Detalle (R1-17b, mocks 1/2/4): explore and compare — "why, when,
// where". The Cockpit is the summary; nothing here repeats it in the same
// form. One request loads the period's data (the cube); the filter bar, the
// three tabs and every click are computed in the browser. The state lives in
// the URL.

import { SalesDetailV2 } from "@/components/restaurant/sales/detail/SalesDetailV2";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { parseDetailState } from "@/lib/restaurant/sales-detail";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

export default async function SalesDetailPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const [{ lang }, params] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = first(v);
  // Old links (?period=last_7 | month) keep working.
  if (!flat.p && flat.period === "month") flat.p = "30d";
  const location = flat.location ?? null;

  return (
    <div className="w-full px-6 py-3 lg:px-10 space-y-2">
      <OperatingPageHeader
        title="Ventas › Detalle"
        lang={lang}
        showDateRange={false}
      />
      <SalesDetailV2 initial={parseDetailState(flat)} locationId={location} />
    </div>
  );
}
