// Proveedores now live in Costos › Proveedores (R1-09b, A9).
// Old links land there; every other query param survives.

import { redirect } from "next/navigation";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";

export const dynamic = "force-dynamic";

export default async function SuppliersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(costsTabHref("proveedores", await searchParams));
}
