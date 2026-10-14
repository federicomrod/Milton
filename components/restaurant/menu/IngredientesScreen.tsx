"use client";

// components/restaurant/menu/IngredientesScreen.tsx
//
// Menú › Ingredientes (R1-09b, A6/D7): list on the left, detail on the
// right. Selection lives in client state and is mirrored to the URL with
// history.replaceState (no server round trip). Saves go through the
// existing APIs: PATCH /api/restaurant/ingredients/:id for unit and
// category, POST /api/restaurant/ingredient-costs for the price (one
// manual cost entry dated today). Local state is updated from the
// responses; the page is never refreshed.

import { invalidatePickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GroupedItemList } from "@/components/restaurant/groups/GroupedItemList";
import { useItemGroups } from "@/components/restaurant/groups/use-item-groups";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import { dishHref } from "@/lib/restaurant/menu-links";
import { normalizeUnit } from "@/lib/restaurant/units";
import {
  PRICE_SOURCE_LABEL,
  lineImpactAfterPrice,
  parsePriceInput,
  priceChangePct,
  sortIngredientes,
  type IngredientesFilter,
  type PriceSource,
} from "@/lib/restaurant/ingredientes-screen";

export interface SupplierOption {
  id: string;
  name: string;
}

export interface IngredienteUse {
  odoo_product_id: number;
  dish_name: string;
  qty: number;
  unit: string;
  /** Line cost; null = no price (shown as "Sin precio", never $0). */
  amount: number | null;
  units_sold: number;
  net_sales: number;
}

export interface IngredienteItem {
  id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  /** Latest price per price_unit; null = "Falta precio". */
  price: number | null;
  price_unit: string | null;
  price_date: string | null;
  previous_price: number | null;
  source: PriceSource | null;
  supplier_id: string | null;
  supplier_name: string | null;
  sold_net_sales: number;
  uses: IngredienteUse[];
}

const UNITS = ["kg", "g", "l", "ml", "unit", "portion", "oz", "lb"];
const ORANGE = "#f28c28";
const RED = "#d14343";
const GREEN = "#1f9d55";
const MUTED = "#8a92a3";

function formatMoney(n: number, currency: string): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat(safe === "MXN" ? "es-MX" : "en-US", {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(n) < 1 && n !== 0 ? 4 : 2,
  }).format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatQty(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(n);
}

function todayIso(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameUnit(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return (normalizeUnit(a) ?? a) === (normalizeUnit(b) ?? b);
}

function categoryLabel(category: string | null): string {
  if (!category || category === "uncategorized") return "Sin categoría";
  return category;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function errorOf(body: unknown, status: number): string {
  const b = body as { error?: unknown; details?: unknown } | null;
  return typeof b?.error === "string" ? b.error : `Error ${status}`;
}

export function IngredientesScreen({
  items: initialItems,
  suppliers,
  currency,
  initialSelectedId,
  initialFilter,
  itemGroups = null,
}: {
  items: IngredienteItem[];
  suppliers: SupplierOption[];
  currency: string;
  initialSelectedId: string | null;
  initialFilter: IngredientesFilter;
  itemGroups?: ItemGroupsLoad | null;
}) {
  const grouping = useItemGroups(itemGroups);
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<IngredientesFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && initialItems.some((i) => i.id === initialSelectedId)
      ? initialSelectedId
      : null
  );

  const missingCount = useMemo(
    () => items.filter((i) => i.price === null).length,
    [items]
  );
  const visible = useMemo(() => {
    const q = fold(query.trim());
    const sorted = sortIngredientes(items, filter);
    if (!q) return sorted;
    return sorted.filter(
      (i) =>
        fold(i.name).includes(q) ||
        (i.supplier_name ? fold(i.supplier_name).includes(q) : false)
    );
  }, [items, filter, query]);

  const selected = items.find((i) => i.id === selectedId) ?? visible[0] ?? null;

  // Mirror selection and filter to the URL without a server request.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("ingrediente", selectedId);
    else url.searchParams.delete("ingrediente");
    if (filter === "falta_precio") url.searchParams.set("filtro", filter);
    else url.searchParams.delete("filtro");
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url.toString());
    }
  }, [selectedId, filter]);

  const onSaved = (next: IngredienteItem) =>
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));

  const onAdded = (item: IngredienteItem) => {
    setItems((prev) => [...prev, item]);
    setQuery("");
    setSelectedId(item.id);
  };

  return (
    <div className="mt-3 grid grid-cols-[330px_1fr] items-start gap-[14px]">
      <section className="flex flex-col rounded-[14px] border border-[#eef0f4] bg-white">
        <div className="space-y-2 border-b border-[#eef0f4] p-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ingrediente…"
            aria-label="Buscar ingrediente"
            className="h-9 w-full rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] text-[#151c2c] outline-none focus:border-[#f28c28]"
          />
          <div className="flex gap-2" role="group" aria-label="Filtro">
            <FilterChip
              active={filter === "todos"}
              onClick={() => setFilter("todos")}
            >
              Todos
            </FilterChip>
            <FilterChip
              active={filter === "falta_precio"}
              onClick={() => setFilter("falta_precio")}
            >
              Falta precio ({missingCount})
            </FilterChip>
          </div>
        </div>
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-2">
          <GroupedItemList
            items={visible}
            scope="ingredient"
            grouping={grouping}
            canEdit
            storageKey="milton:ingredientes:abiertos"
            emptyText={
              items.length === 0
                ? "Aún no tienes ingredientes."
                : "Ningún ingrediente coincide."
            }
            renderRow={(item) => {
              const isSelected = selected?.id === item.id;
              return (
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={
                    "flex w-full items-center justify-between gap-3 border-b border-[#f3f4f7] px-2 py-2.5 text-left " +
                    (isSelected
                      ? "bg-[#fff6ec] shadow-[inset_3px_0_0_#f28c28]"
                      : "hover:bg-[#fafbfc]")
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-[#151c2c]">
                      {item.name}
                    </span>
                    <span
                      className="block truncate text-[12px]"
                      style={{ color: MUTED }}
                    >
                      {item.supplier_name ?? "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[13px] tabular-nums">
                    {item.price === null ? (
                      <span className="font-semibold" style={{ color: RED }}>
                        Falta precio
                      </span>
                    ) : (
                      <span className="text-[#151c2c]">
                        {formatMoney(item.price, currency)}
                        <span style={{ color: MUTED }}>
                          {" "}
                          / {item.price_unit ?? item.default_unit ?? "—"}
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              );
            }}
          />
        </div>
        <AddIngrediente onAdded={onAdded} />
      </section>

      {selected ? (
        <IngredienteDetail
          key={selected.id}
          item={selected}
          suppliers={suppliers}
          currency={currency}
          onSaved={onSaved}
        />
      ) : (
        <section
          className="rounded-[14px] border border-[#eef0f4] bg-white p-6 text-[13px]"
          style={{ color: MUTED }}
        >
          Elige un ingrediente de la lista.
        </section>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 text-[12px] font-semibold " +
        (active
          ? "border-[#f28c28] bg-[#fff6ec] text-[#b25e10]"
          : "border-[#e3e7ee] bg-white text-[#6b7385] hover:text-[#151c2c]")
      }
    >
      {children}
    </button>
  );
}

function AddIngrediente({
  onAdded,
}: {
  onAdded: (item: IngredienteItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Names or prices change: the recipe picker reloads its list.
      invalidatePickerOptions();
      const res = await fetch("/api/restaurant/ingredients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, default_unit: "kg" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ingredient) {
        setError(errorOf(body, res.status));
        return;
      }
      const ing = body.ingredient as {
        id: string;
        name: string;
        category: string | null;
        default_unit: string | null;
      };
      onAdded({
        id: ing.id,
        name: ing.name,
        category: ing.category,
        default_unit: ing.default_unit,
        price: null,
        price_unit: null,
        price_date: null,
        previous_price: null,
        source: null,
        supplier_id: null,
        supplier_name: null,
        sold_net_sales: 0,
        uses: [],
      });
      setName("");
      setOpen(false);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-3 text-left text-[13px] font-semibold text-[#b25e10] hover:bg-[#fafbfc]"
      >
        + Agregar ingrediente
      </button>
    );
  }
  return (
    <div className="space-y-1.5 px-3 py-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Nombre del ingrediente"
          aria-label="Nombre del ingrediente"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[#e3e7ee] px-3 text-[13px] outline-none focus:border-[#f28c28]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          className="h-9 rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] font-semibold text-[#151c2c] disabled:opacity-50"
        >
          {saving ? "Agregando…" : "Agregar"}
        </button>
      </div>
      {error && (
        <p className="text-[12px]" style={{ color: RED }}>
          {error}
        </p>
      )}
    </div>
  );
}

function IngredienteDetail({
  item,
  suppliers,
  currency,
  onSaved,
}: {
  item: IngredienteItem;
  suppliers: SupplierOption[];
  currency: string;
  onSaved: (next: IngredienteItem) => void;
}) {
  const [priceDraft, setPriceDraft] = useState(
    item.price === null ? "" : formatMoney(item.price, currency)
  );
  const [unitDraft, setUnitDraft] = useState(item.default_unit ?? "kg");
  const [categoryDraft, setCategoryDraft] = useState(
    item.category && item.category !== "uncategorized" ? item.category : ""
  );
  const [supplierDraft, setSupplierDraft] = useState(item.supplier_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsedPrice = parsePriceInput(priceDraft);
  const priceChanged =
    priceDraft.trim() !== "" &&
    (parsedPrice === null ||
      item.price === null ||
      Math.abs(parsedPrice - item.price) > 1e-9);
  const unitChanged = unitDraft !== (item.default_unit ?? "kg");
  const currentCategory =
    item.category && item.category !== "uncategorized" ? item.category : "";
  const categoryChanged = categoryDraft.trim() !== currentCategory;
  const supplierChanged = supplierDraft !== (item.supplier_id ?? "");
  const dirty =
    priceChanged || unitChanged || categoryChanged || supplierChanged;

  const change = priceChangePct(item.price, item.previous_price);
  const unitMismatch =
    item.price !== null &&
    !!item.price_unit &&
    !sameUnit(item.price_unit, unitDraft);
  const units = UNITS.includes(unitDraft) ? UNITS : [unitDraft, ...UNITS];

  const save = async () => {
    if (!dirty || saving) return;
    setError(null);
    setSaved(false);
    if (priceChanged && parsedPrice === null) {
      setError("Escribe un precio válido, por ejemplo 12.40.");
      return;
    }
    // A supplier lives on the price entry: changing it alone needs a
    // price in the current unit to carry over.
    let entryPrice: number | null = priceChanged ? parsedPrice : null;
    if (entryPrice === null && supplierChanged) {
      if (item.price === null || unitMismatch) {
        setError("Escribe el precio para guardar el proveedor.");
        return;
      }
      entryPrice = item.price;
    }

    setSaving(true);
    let next: IngredienteItem = { ...item };
    try {
      if (unitChanged || categoryChanged) {
        const patch: Record<string, string> = {};
        if (unitChanged) patch.default_unit = unitDraft;
        if (categoryChanged) patch.category = categoryDraft.trim();
        // Names or prices change: the recipe picker reloads its list.
        invalidatePickerOptions();
        const res = await fetch(`/api/restaurant/ingredients/${item.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ingredient) {
          setError(errorOf(body, res.status));
          return;
        }
        next = {
          ...next,
          category: body.ingredient.category ?? null,
          default_unit: body.ingredient.default_unit ?? unitDraft,
        };
        onSaved(next);
      }

      if (entryPrice !== null) {
        // Names or prices change: the recipe picker reloads its list.
        invalidatePickerOptions();
        const res = await fetch("/api/restaurant/ingredient-costs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredient_id: item.id,
            cost_date: todayIso(),
            quantity: 1,
            unit: unitDraft,
            total_cost: entryPrice,
            currency,
            supplier_id: supplierDraft || null,
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.entry) {
          setError(errorOf(body, res.status));
          return;
        }
        const entry = body.entry as {
          normalized_unit_cost: number;
          normalized_unit: string;
          cost_date: string;
          supplier_id: string | null;
        };
        const newPrice = Number(entry.normalized_unit_cost);
        const previous =
          item.price !== null &&
          sameUnit(item.price_unit, entry.normalized_unit)
            ? item.price
            : null;
        next = {
          ...next,
          price: newPrice,
          price_unit: entry.normalized_unit,
          price_date: entry.cost_date,
          previous_price: previous,
          source: "manual",
          supplier_id: entry.supplier_id ?? null,
          supplier_name:
            suppliers.find((s) => s.id === entry.supplier_id)?.name ?? null,
          uses: item.uses.map((u) => ({
            ...u,
            amount: lineImpactAfterPrice({
              qty: u.qty,
              unit: u.unit,
              oldAmount: u.amount,
              oldPrice: item.price,
              newPrice,
              newPriceUnit: entry.normalized_unit,
            }),
          })),
        };
        onSaved(next);
        setPriceDraft(formatMoney(newPrice, currency));
      }
      setSaved(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[14px] border border-[#eef0f4] bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold text-[#151c2c]">
            {item.name}
          </h2>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {categoryLabel(item.category)} · en {item.uses.length}{" "}
            {item.uses.length === 1 ? "plato" : "platos"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {error && (
            <span className="max-w-[320px] text-[12px]" style={{ color: RED }}>
              {error}
            </span>
          )}
          {saved && !error && !dirty && (
            <span className="text-[12px]" style={{ color: GREEN }}>
              Guardado
            </span>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="h-9 rounded-lg px-5 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: ORANGE }}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
        <div>
          <p className="text-[12px] font-semibold" style={{ color: MUTED }}>
            Precio actual
          </p>
          <div className="flex items-baseline gap-1.5">
            <input
              value={priceDraft}
              onChange={(e) => {
                setPriceDraft(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="Falta precio"
              aria-label="Precio actual"
              inputMode="decimal"
              className={
                "w-[170px] rounded-md border border-transparent bg-transparent px-1 text-[30px] font-extrabold tabular-nums outline-none hover:border-[#e3e7ee] focus:border-[#f28c28] " +
                (priceDraft.trim() === ""
                  ? "placeholder:text-[#d14343]"
                  : "text-[#151c2c]")
              }
            />
            <span
              className="text-[14px] font-semibold"
              style={{ color: MUTED }}
            >
              /
            </span>
            <select
              value={unitDraft}
              onChange={(e) => {
                setUnitDraft(e.target.value);
                setSaved(false);
              }}
              aria-label="Unidad"
              className="h-8 rounded-md border border-[#e3e7ee] bg-white px-1.5 text-[14px] font-semibold text-[#151c2c]"
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          {unitMismatch && (
            <p className="mt-1 text-[12px]" style={{ color: RED }}>
              El precio guardado es por {item.price_unit}.
            </p>
          )}
          {/* R1-15a: a save that fails says why, right under the price. */}
          {error && (
            <p role="alert" className="mt-1 text-[12px]" style={{ color: RED }}>
              {error}
            </p>
          )}
          {priceDraft.trim() === "" && item.price === null && (
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
              ¿Es gratis (agua, hielo)? Escribe 0 para confirmarlo.
            </p>
          )}
        </div>
        <div>
          <p className="text-[12px] font-semibold" style={{ color: MUTED }}>
            Cambio 30 días
          </p>
          <p
            className="text-[30px] font-extrabold tabular-nums"
            style={{
              color:
                change === null || change === 0
                  ? "#151c2c"
                  : change > 0
                    ? RED
                    : GREEN,
            }}
          >
            {change === null
              ? "—"
              : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
          </p>
        </div>
        <div>
          <p className="text-[12px] font-semibold" style={{ color: MUTED }}>
            Categoría
          </p>
          <input
            value={categoryDraft}
            onChange={(e) => {
              setCategoryDraft(e.target.value);
              setSaved(false);
            }}
            placeholder="Sin categoría"
            aria-label="Categoría"
            className="mt-2 h-9 w-[180px] rounded-md border border-[#e3e7ee] px-2 text-[13px] text-[#151c2c] outline-none focus:border-[#f28c28]"
          />
        </div>
      </div>

      <p
        className="mt-4 flex flex-wrap items-center gap-1.5 text-[13px]"
        style={{ color: MUTED }}
      >
        <span>Proveedor</span>
        <select
          value={supplierDraft}
          onChange={(e) => {
            setSupplierDraft(e.target.value);
            setSaved(false);
          }}
          aria-label="Proveedor"
          className="h-8 rounded-md border border-[#e3e7ee] bg-white px-1.5 text-[13px] text-[#151c2c]"
        >
          <option value="">—</option>
          {item.supplier_id &&
            !suppliers.some((s) => s.id === item.supplier_id) && (
              <option value={item.supplier_id}>
                {item.supplier_name ?? "Proveedor"}
              </option>
            )}
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span>· desde {formatDate(item.price_date)}</span>
        {item.source && (
          <span>· Fuente: {PRICE_SOURCE_LABEL[item.source]}</span>
        )}
      </p>

      <h3 className="mt-6 text-[14px] font-bold text-[#151c2c]">Se usa en</h3>
      {item.uses.length === 0 ? (
        <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
          Ningún plato usa este ingrediente.
        </p>
      ) : (
        <table className="mt-2 w-full text-[13px]">
          <thead>
            <tr
              className="border-b border-[#eef0f4] text-left text-[12px]"
              style={{ color: MUTED }}
            >
              <th className="py-2 font-semibold">Plato</th>
              <th className="py-2 text-right font-semibold">Cantidad</th>
              <th className="py-2 text-right font-semibold">Impacto</th>
            </tr>
          </thead>
          <tbody>
            {item.uses.map((u) => (
              <tr
                key={u.odoo_product_id}
                className="border-b border-[#f3f4f7] last:border-0"
              >
                <td className="py-2">
                  <Link
                    href={dishHref(u.odoo_product_id)}
                    className="font-semibold text-[#151c2c] hover:text-[#b25e10] hover:underline"
                  >
                    {u.dish_name}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums text-[#151c2c]">
                  {formatQty(u.qty)} {u.unit}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {u.amount === null ? (
                    <span style={{ color: RED }}>Sin precio</span>
                  ) : (
                    <span className="text-[#151c2c]">
                      {formatMoney(u.amount, currency)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
