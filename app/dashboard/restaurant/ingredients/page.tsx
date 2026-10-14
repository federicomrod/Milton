// Old URL (R1-09b, A6): /dashboard/restaurant/ingredients → Menú ›
// Ingredientes. Every param (ingrediente, location, filtro…) is kept.

import { redirect } from "next/navigation";
import { redirectToIngredientes } from "@/lib/restaurant/recetas-redirect";

export default async function IngredientsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(redirectToIngredientes(await searchParams));
}
