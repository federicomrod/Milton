// app/dashboard/restaurant/sales/detalle/page.tsx
//
// There is ONE Ventas page now (Fede, Oct 17): the old Detalle IS Ventas. This
// address only forwards, keeping every query param (the old ?period= becomes ?p=).

import { redirect } from "next/navigation";
import { ventasRedirectHref } from "@/lib/restaurant/sales-ventas-url";

export const dynamic = "force-dynamic";

export default async function SalesDetailRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(ventasRedirectHref(await searchParams));
}
