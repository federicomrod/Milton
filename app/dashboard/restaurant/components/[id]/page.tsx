// The old preparation builder is gone: preparations are reviewed, edited
// and approved in Recetas y costeo › Preparaciones. Old links land there.

import { redirect } from "next/navigation";
import { recetasHref } from "@/lib/restaurant/recetas-redirect";

export const dynamic = "force-dynamic";

export default async function ComponentRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const [{ id }, { location }] = await Promise.all([params, searchParams]);
  redirect(recetasHref({ location, vista: "preparaciones", prep: id }));
}
