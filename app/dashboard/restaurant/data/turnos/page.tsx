// app/dashboard/restaurant/data/turnos/page.tsx
//
// Moved: Configuración is one page with tabs. This route keeps old links
// working and lands on the Turnos tab, keeping the other params.

import { redirect } from "next/navigation";
import { hrefKeepingParams } from "@/lib/restaurant/navigation";
import { DATA_SETTINGS_HREF } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default async function TurnosRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(hrefKeepingParams(DATA_SETTINGS_HREF, { ...params, tab: "turnos" }));
}
