// The POS sales file upload now lives in Configuración › Conexiones
// ("Subir ventas (archivo)", R1-09b A10). Old links land there with the
// panel open; every other query param survives.

import { redirect } from "next/navigation";
import { posUploadHref } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default async function PosUploadRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(posUploadHref(await searchParams));
}
