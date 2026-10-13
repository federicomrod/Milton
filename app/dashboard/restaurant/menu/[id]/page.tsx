// The old recipe builder is gone: dish recipes are edited and approved in
// Recetas y costeo › Plato por plato, the one controlled path (no recipe is
// saved outside the approval model). Old links land on that dish when it
// is linked to a POS product, otherwise on Plato por plato.

import { redirect } from "next/navigation";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { recetasHref } from "@/lib/restaurant/recetas-redirect";

export const dynamic = "force-dynamic";

export default async function MenuItemRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const [{ id }, { location }] = await Promise.all([params, searchParams]);
  let producto: number | null = null;
  const auth = await authAndCompany();
  if (auth.ok) {
    const { data } = await auth.supabase
      .from("pos_product_links")
      .select("odoo_product_id")
      .eq("company_id", auth.companyId)
      .eq("menu_item_id", id)
      .limit(1);
    const value = data?.[0]?.odoo_product_id;
    producto = typeof value === "number" ? value : null;
  }
  redirect(recetasHref({ location, vista: "plato", producto }));
}
