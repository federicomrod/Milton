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
        if (!res.ok)
          throw new Error(json.error ?? "No pude cargar los platos.");
        return json as DishesPayload;
      })
      .then((j) => !cancelled && setAnswer({ key: requestKey, data: j }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setAnswer({
            key: requestKey,
            error:
              e instanceof Error ? e.message : "No pude cargar los platos.",
          })
      );
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, locationId, requestKey]);

  const wanted = useMemo(
    () => new Set(categories.map((c) => c.toLowerCase())),
    [categories]
  );
  const dishes = useMemo(() => {
    const all = data?.menu_dishes ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((d) =>
        wanted.size === 0
          ? true
          : wanted.has((d.category ?? "Sin categoría").toLowerCase())
      )
      .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
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
          backLabel="Platos"
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
          aria-label="Buscar plato"
          placeholder="Buscar plato…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-52 rounded-lg border border-[#dfe3ea] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1b40c8]"
        />
        {categories.length > 0 ? (
          <span>
            Categoría:{" "}
            <b className="text-[#1b40c8]">{categories.join(" + ")}</b>
          </span>
        ) : null}
        {channelsActive ? (
          <span className="rounded-md bg-[#f9fafb] px-2 py-0.5 text-[#6b7280]">
            Canal, pago y turno no aplican a Platos: el costo de un plato se
            calcula por período y restaurante.
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
          Cargando platos…
        </p>
      ) : dishes.length === 0 ? (
        <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#8a92a3]">
          Sin platos con estos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[#eef0f4] bg-white px-3 py-1.5">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#eef0f4] text-[11px] font-semibold text-[#8a92a3]">
                <th className="px-2 py-1.5 text-left">Plato</th>
                <th className="px-2 py-1.5 text-left">Categoría</th>
                <th className="px-2 py-1.5 text-right">Ventas ▾</th>
                <th className="px-2 py-1.5 text-right">Unid.</th>
                <th className="px-2 py-1.5 text-right">Costo</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {dishes.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setOpen(d.id)}
                  className="cursor-pointer border-b border-[#f2f3f6] hover:bg-[#f7f9ff]"
                >
                  <td className="px-2 py-1 font-bold">{d.name}</td>
                  <td className="px-2 py-1 text-[#6b7385]">
                    {d.category ?? "Sin categoría"}
                  </td>
                  <td className="px-2 py-1 text-right font-bold">
                    {money(d.net_sales)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {Math.round(d.units).toLocaleString("es-MX")}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {d.food_cost_pct === null
                      ? "Sin precio"
                      : `${Math.round(d.food_cost_pct)}%`}
                  </td>
                  <td className="px-2 py-1 text-right text-[11.5px] font-semibold text-[#1b40c8]">
                    Desglose →
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
