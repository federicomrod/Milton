"use client";

// R1-17b: the Platos tab. It is NOT a new drill-down: the list is the menu
// dishes of the page's period and restaurant (the same economics as Menú ›
// Platos) and a click opens the existing «Plato del menú» Desglose
// (DrillView), read-only here. Period, restaurant and Categoría narrow it;
// Canal, Pago and Turno cannot (dish costing is by period and restaurant).

import { useEffect, useMemo, useState } from "react";
import { DrillView } from "@/components/restaurant/menu/DrillView";
import { DrillErrorBoundary } from "@/components/restaurant/menu/DrillErrorBoundary";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { useT } from "@/lib/i18n/client";
import { NO_CATEGORY_LABEL } from "@/lib/restaurant/sales-detail-cube";
import { categoryLabel } from "@/lib/restaurant/sales-detail";
import { userErrorMessage } from "@/lib/restaurant/user-error";

interface DishesPayload {
  menu_dishes: MenuDish[];
  menu_sales: number;
}

// The drill-down expects the grouping controller of Menú; here it is read-only.
const READ_ONLY_GROUPING = {
  available: false,
  state: { groups: [], members: [] },
  run: async () => true,
  created: null,
  toast: null,
  dismissToast() {},
  notify() {},
} as never;

export function PlatosTab({
  range,
  locationId,
  restaurants,
  categories,
  channelsActive,
  money,
}: {
  range: { from: string; to: string };
  locationId: string | null;
  restaurants: Array<{ id: string; name: string }>;
  /** Selected categories of the page (Categoría filter). */
  categories: string[];
  /** Canal / Pago / Turno are active: say they do not apply here. */
  channelsActive: boolean;
  money: (n: number, d?: number) => string;
}) {
  const { d, lang, locale } = useT();
  const p0 = d.sales.detail.dishes;
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const requestKey = `${range.from}|${range.to}|${locationId ?? ""}`;
  const [answer, setAnswer] = useState<{
    key: string;
    data?: DishesPayload;
    error?: string;
  } | null>(null);
  const current = answer && answer.key === requestKey ? answer : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (locationId) q.set("location_id", locationId);
    fetch(`/api/restaurant/sales-detail-dishes?${q.toString()}`)
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as Partial<DishesPayload> & { error?: string };
        if (!res.ok) throw new Error(userErrorMessage(json, p0.loadFailed));
        return json as DishesPayload;
      })
      .then((j) => !cancelled && setAnswer({ key: requestKey, data: j }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setAnswer({
            key: requestKey,
            error: e instanceof Error ? e.message : p0.loadFailed,
          })
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, locationId, requestKey]);

  const wanted = useMemo(
    () => new Set(categories.map((c) => c.toLowerCase())),
    [categories]
  );
  const dishes = useMemo(() => {
    const all = data?.menu_dishes ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((dish) =>
        wanted.size === 0
          ? true
          : wanted.has((dish.category ?? NO_CATEGORY_LABEL).toLowerCase())
      )
      .filter((dish) => (q ? dish.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.net_sales - a.net_sales);
  }, [data, wanted, query]);

  const dish = open
    ? (data?.menu_dishes ?? []).find((d) => d.id === open)
    : null;
  if (dish) {
    return (
      <DrillErrorBoundary title={dish.name} onBack={() => setOpen(null)}>
        <DrillView
          title={dish.name}
          variants={dish.variants}
          scopeId={dish.id}
          menuSales={data?.menu_sales ?? 0}
          grouping={READ_ONLY_GROUPING}
          canEdit={false}
          money={(n) => money(n, 0)}
          onBack={() => setOpen(null)}
          backLabel={p0.back}
          restaurants={restaurants}
          showRestaurants={!locationId}
        />
      </DrillErrorBoundary>
    );
  }

  return (
    <section data-testid="sales-platos">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[#6b7385]">
        <input
          aria-label={p0.searchAria}
          placeholder={p0.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-52 rounded-lg border border-[#dfe3ea] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1b40c8]"
        />
        {categories.length > 0 ? (
          <span>
            {p0.categoryLabel}{" "}
            <b className="text-[#1b40c8]">{categories.join(" + ")}</b>
          </span>
        ) : null}
        {channelsActive ? (
          <span className="rounded-md bg-[#f9fafb] px-2 py-0.5 text-[#6b7280]">
            {p0.notFiltered}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-6 text-[13px] text-[#c03535]"
        >
          {error}
        </p>
      ) : !data ? (
        <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#8a92a3]">
          {p0.loading}
        </p>
      ) : dishes.length === 0 ? (
        <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#8a92a3]">
          {p0.none}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[#eef0f4] bg-white px-3 py-1.5">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#eef0f4] text-[11px] font-semibold text-[#8a92a3]">
                <th className="px-2 py-1.5 text-left">{p0.colDish}</th>
                <th className="px-2 py-1.5 text-left">{p0.colCategory}</th>
                <th className="px-2 py-1.5 text-right">{p0.colSales}</th>
                <th className="px-2 py-1.5 text-right">{p0.colUnits}</th>
                <th className="px-2 py-1.5 text-right">{p0.colCost}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {dishes.map((dish) => (
                <tr
                  key={dish.id}
                  onClick={() => setOpen(dish.id)}
                  className="cursor-pointer border-b border-[#f2f3f6] hover:bg-[#f7f9ff]"
                >
                  <td className="px-2 py-1 font-bold">{dish.name}</td>
                  <td className="px-2 py-1 text-[#6b7385]">
                    {categoryLabel(dish.category ?? NO_CATEGORY_LABEL, lang)}
                  </td>
                  <td className="px-2 py-1 text-right font-bold">
                    {money(dish.net_sales)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {Math.round(dish.units).toLocaleString(locale)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {dish.food_cost_pct === null
                      ? p0.noPrice
                      : `${Math.round(dish.food_cost_pct)}%`}
                  </td>
                  <td className="px-2 py-1 text-right text-[11.5px] font-semibold text-[#1b40c8]">
                    {p0.breakdown}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
