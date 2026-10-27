// The old English «Centro de agentes» page is retired (#379). Nothing was
// approved there any more: Ask Milton only offers links to the screen where
// you act. Old links and bookmarks land on Resumen with their params.

import { redirect } from "next/navigation";
import { COCKPIT_HREF, hrefKeepingParams } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default async function AgentsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(hrefKeepingParams(COCKPIT_HREF, await searchParams));
}
