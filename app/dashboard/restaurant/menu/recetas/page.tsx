// Old URL (R1-09b, A4): /menu/recetas?vista=plato|preparaciones → the
// Menú tab; no vista → Resumen. Every other param (producto, prep,
// location, from, to, estado) is kept.

import { redirect } from "next/navigation";
import { redirectFromRecetas } from "@/lib/restaurant/recetas-redirect";

export default async function RecetasRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(redirectFromRecetas(await searchParams));
}
