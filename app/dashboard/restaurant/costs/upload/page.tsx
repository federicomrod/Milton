// The old Costos › Subir import is gone: the one cost-file upload lives in
// Menú › Recetas y costeo. Old links land there (no 404).

import { redirect } from "next/navigation";
import { recetasHref } from "@/lib/restaurant/recetas-redirect";

export const dynamic = "force-dynamic";

export default async function CostsUploadRedirect({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  redirect(recetasHref({ location }));
}
