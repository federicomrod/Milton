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
import {
  DuplicatesBanner,
  ManualMergeDialog,
  useDuplicateQueue,
} from "@/components/restaurant/menu/IngredientDuplicates";
import {
  NO_DUPLICATE_STATE,
  type DuplicateState,
} from "@/lib/restaurant/ingredient-duplicates-server";
import { useEffect, useMemo, useState } from "react";
import {
  useGroupedItemList,
  type SortColumn,
} from "@/components/restaurant/groups/GroupedItemList";
import { useItemGroups } from "@/components/restaurant/groups/use-item-groups";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import {
  matchesUsage,
  usageCounts,
  type UsageFilter,
} from "@/lib/restaurant/ingredient-usage";
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
  /** The latest price entry (what a merge can choose as THE price). */
  price_entry_id?: string | null;
  /** Active dishes that use it, and active recipe lines that name it (a merge reassigns those). */
  recipeCount?: number;
  lineCount?: number;
  previous_price: number | null;
  source: PriceSource | null;
  supplier_id: string | null;
  supplier_name: string | null;
  sold_net_sales: number;
  uses: IngredienteUse[];
  /** An active recipe (dish, or preparation an active dish uses) has a line with it. */
  inUse: boolean;
  /** Soft-hidden (050). Never true for an ingredient in use. */
  archived: boolean;
}

const UNITS = ["kg", "g", "l", "ml", "unit", "portion", "oz", "lb"];
const RED = "#d14343";
const AMBER = "#a35a00";
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

const INGREDIENT_SORT: SortColumn<IngredienteItem>[] = [
  { key: "name", label: "Nombre", value: (i) => i.name },
  // A missing price is "Sin precio": last both ways, never 0.
  { key: "price", label: "Precio", value: (i) => i.price },
  { key: "supplier", label: "Proveedor", value: (i) => i.supplier_name },
  {
    key: "sales",
    label: "Ventas",
    value: (i) => i.sold_net_sales,
    agg: "sum",
  },
];

export function IngredientesScreen({
  items: initialItems,
  suppliers,
  currency,
  initialSelectedId,
  initialFilter,
  itemGroups = null,
  archiveAvailable = true,
  duplicates = NO_DUPLICATE_STATE,
}: {
  items: IngredienteItem[];
  suppliers: SupplierOption[];
  currency: string;
  initialSelectedId: string | null;
  initialFilter: IngredientesFilter;
  itemGroups?: ItemGroupsLoad | null;
  /** False until migration 050: En uso / Sin uso work, Archivar says what is missing. */
  archiveAvailable?: boolean;
  /** Possible duplicates and the merge history (051); empty before it is applied. */
  duplicates?: DuplicateState;
}) {
  const grouping = useItemGroups(itemGroups);
  const [items, setItems] = useState(initialItems);
  // A merge or an undo re-reads the page: the new rows replace ours.
  const [seenItems, setSeenItems] = useState(initialItems);
  if (seenItems !== initialItems) {
    setSeenItems(initialItems);
    setItems(initialItems);
  }
  const dupQueue = useDuplicateQueue({ items, duplicates });
  /** «Unir…» from the selection bar: the selected ids, and how to clear them. */
  const [mergeSel, setMergeSel] = useState<{
    ids: string[];
    clear: () => void;
  } | null>(null);
  const [filter, setFilter] = useState<IngredientesFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && initialItems.some((i) => i.id === initialSelectedId)
      ? initialSelectedId
      : null
  );

  const [usageFilter, setUsageFilter] = useState<UsageFilter>("en_uso");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  // Unused ingredients never count toward "Falta precio" and never ask for a price.
  const counts = useMemo(() => usageCounts(items), [items]);
  const visible = useMemo(() => {
    const inUsage = items.filter((i) => matchesUsage(i, usageFilter));
    return sortIngredientes(
      filter === "falta_precio" ? inUsage.filter((i) => i.inUse) : inUsage,
      filter
    );
  }, [items, filter, usageFilter]);

  async function setArchived(ids: string[], archived: boolean) {
    if (ids.length === 0) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch("/api/restaurant/ingredients/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, archived }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        skipped?: string[];
      };
      if (!res.ok) throw new Error(json.error ?? "No pude archivar.");
      const done = new Set(ids.filter((id) => !json.skipped?.includes(id)));
      setItems((prev) =>
        prev.map((i) => (done.has(i.id) ? { ...i, archived } : i))
      );
    } catch (err) {
      setArchiveError(
        err instanceof Error
          ? err.message
          : "No pude archivar los ingredientes."
      );
    } finally {
      setArchiving(false);
    }
  }
  const archiveAll = () => {
    const ids = items.filter((i) => !i.inUse && !i.archived).map((i) => i.id);
    if (
      window.confirm(
        `¿Archivar ${ids.length} ingredientes sin uso? No se borran: vuelven solos si una receta los usa, y puedes restaurarlos.`
      )
    ) {
      void setArchived(ids, true);
    }
  };

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
    // A new ingredient has no recipe yet: show it, do not hide it as "sin uso".
    setUsageFilter("todos");
    setSelectedId(item.id);
  };

  // The toolbar (search, Milton's suggestions, grouping tabs, filters, sort)
  // spans the full width above the list and the detail; the list column keeps
  // only the rows.
  const { toolbar, list } = useGroupedItemList({
    items: visible,
    scope: "ingredient",
    grouping,
    canEdit: true,
    onMergeSelected: (ids, clear) => setMergeSel({ ids, clear }),
    storageKey: "milton:ingredientes:abiertos",
    sortId: "ingredientes",
    sortColumns: INGREDIENT_SORT,
    searchPlaceholder: "Buscar ingrediente o grupo…",
    searchText: (item) => item.supplier_name,
    categoryOf: (item) => item.category,
    emptyText:
      items.length === 0
        ? "Aún no tienes ingredientes."
        : "Ningún ingrediente coincide.",
    filters: (
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[12px] font-semibold"
          role="group"
          aria-label="Uso"
        >
          {(
            [
              ["en_uso", "En uso", counts.en_uso],
              ["sin_uso", "Sin uso", counts.sin_uso],
              ["todos", "Todos", counts.todos],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={usageFilter === id}
              onClick={() => setUsageFilter(id)}
              className={
                "rounded-[9px] px-2.5 py-1 " +
                (usageFilter === id
                  ? "bg-[#1b40c8] text-white shadow-sm"
                  : "text-[#4a5a85] hover:text-[#1b40c8]")
              }
            >
              {label} · {n}
            </button>
          ))}
        </div>
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
            Falta precio ({counts.falta_precio})
          </FilterChip>
        </div>
        {counts.archivable > 0 ? (
          <button
            type="button"
            onClick={archiveAll}
            disabled={archiving || !archiveAvailable}
            title={
              archiveAvailable
                ? "Los oculta de las listas de trabajo; no se borra nada."
                : "Falta aplicar la migración 050 en este ambiente."
            }
            className="rounded-lg border border-[#c6d3f5] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb] disabled:opacity-50"
          >
            Archivar sin uso ({counts.archivable})
          </button>
        ) : null}
        {!archiveAvailable && counts.sin_uso > 0 ? (
          <span className="text-[12px]" style={{ color: MUTED }}>
            Para archivar falta aplicar la migración 050 en este ambiente.
          </span>
        ) : null}
        {archiveError ? (
          <span className="text-[12px]" style={{ color: RED }}>
            {archiveError}
          </span>
        ) : null}
      </div>
    ),
    renderRow: (item) => {
      const isSelected = selected?.id === item.id;
      return (
        <button
          type="button"
          onClick={() => {
            setSelectedId(item.id);
            dupQueue.jumpTo(item.id);
          }}
          aria-current={isSelected ? "true" : undefined}
          title={item.name}
          className={
            "flex w-full items-start justify-between gap-3 border-b border-[#f3f4f7] px-2 py-2.5 text-left " +
            (isSelected
              ? "bg-[#eef2fc] shadow-[inset_3px_0_0_#1b40c8]"
              : "hover:bg-[#fafbfc]")
          }
        >
          <span className="min-w-0">
            <span className="line-clamp-2 break-words text-[13px] font-semibold text-[#151c2c]">
              {item.name}
              {dupQueue.flagged.has(item.id) ? (
                <span className="ml-1.5 rounded-md bg-[#efe8ff] px-1.5 py-0.5 text-[12px] font-semibold text-[#6d3fc4]">
                  ✦ duplicado?
                </span>
              ) : null}
            </span>
            <span
              className="block truncate text-[12px]"
              style={{ color: MUTED }}
            >
              {item.supplier_name ?? "—"}
            </span>
          </span>
          <span className="shrink-0 text-right text-[13px] tabular-nums">
            {!item.inUse && item.price === null ? (
              <span
                className="font-semibold"
                style={{ color: MUTED }}
                title="Ninguna receta activa lo usa: no hace falta precio."
              >
                {item.archived ? "Archivado" : "Sin uso"}
              </span>
            ) : item.price === null ? (
              <span className="font-semibold" style={{ color: AMBER }}>
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
    },
  });

  return (
    <div className="mt-3 space-y-3">
      <DuplicatesBanner
        q={dupQueue}
        canEdit
        money={(n, unit) =>
          `${formatMoney(n, currency)}${unit ? `/${unit}` : ""}`
        }
      />
      {mergeSel ? (
        <ManualMergeDialog
          q={dupQueue}
          items={items}
          ids={mergeSel.ids}
          money={(n, unit) =>
            `${formatMoney(n, currency)}${unit ? `/${unit}` : ""}`
          }
          onClose={() => setMergeSel(null)}
          onMerged={(survivorId, loserIds) => {
            mergeSel.clear();
            setMergeSel(null);
            // The merged names vanish at once; the refresh brings the rest.
            const gone = new Set(loserIds);
            setItems((prev) =>
              prev.map((i) =>
                gone.has(i.id) ? { ...i, archived: true, inUse: false } : i
              )
            );
            setSelectedId((id) => (id && gone.has(id) ? survivorId : id));
          }}
        />
      ) : null}
      <div
        data-testid="menu-toolbar"
        className="space-y-2 rounded-[14px] border border-[#eef0f4] bg-white p-3"
      >
        {toolbar}
      </div>
      <div className="grid grid-cols-[minmax(300px,360px)_minmax(0,1fr)] items-start gap-[14px]">
        <section className="flex min-w-0 flex-col rounded-[14px] border border-[#eef0f4] bg-white">
          <div
            data-testid="list-column"
            className="max-h-[calc(100vh-220px)] min-h-[200px] overflow-y-auto p-2"
          >
            {list}
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
            archiveAvailable={archiveAvailable}
            archiving={archiving}
            onArchive={(archived) => void setArchived([selected.id], archived)}
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
          ? "border-[#1b40c8] bg-[#e6ecfb] text-[#1b40c8]"
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
        inUse: false,
        archived: false,
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
  archiveAvailable,
  archiving,
  onArchive,
}: {
  item: IngredienteItem;
  suppliers: SupplierOption[];
  currency: string;
  onSaved: (next: IngredienteItem) => void;
  archiveAvailable: boolean;
  archiving: boolean;
  onArchive: (archived: boolean) => void;
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
          {!item.inUse ? (
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
              {item.archived ? "Archivado · " : "Sin uso · "}
              Ninguna receta activa lo usa, así que no hace falta precio.{" "}
              <button
                type="button"
                disabled={archiving || !archiveAvailable}
                onClick={() => onArchive(!item.archived)}
                className="font-semibold text-[#1b40c8] disabled:opacity-50"
              >
                {item.archived ? "Restaurar" : "Archivar"}
              </button>
            </p>
          ) : null}
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
            style={{ backgroundColor: "#1b40c8" }}
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
          <div className="flex items-center gap-1.5">
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
                "h-9 w-[180px] rounded-lg border border-[#c6d3f5] bg-white px-2.5 text-[15px] font-semibold tabular-nums text-[#151c2c] outline-none placeholder:font-normal placeholder:text-[#a35a00] focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20"
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
