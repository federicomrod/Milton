// Moved: Configuración is one scrolling page. This route keeps old links
// working and lands on its «Mi cuenta» section.

import { redirect } from "next/navigation";
import { DATA_SETTINGS_HREF } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default function AccountRedirect() {
  redirect(`${DATA_SETTINGS_HREF}?tab=cuenta`);
}
