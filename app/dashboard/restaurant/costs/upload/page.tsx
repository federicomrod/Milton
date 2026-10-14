// The old Costos › Subir import is gone: cost files are uploaded from
// Menú (R1-09b, A9). Old links land on Menú › Resumen with their params.

import { redirect } from "next/navigation";
import { hrefKeepingParams, MENU_HREF } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default async function CostsUploadRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(hrefKeepingParams(MENU_HREF, await searchParams));
}
