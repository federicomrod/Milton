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

import { useT } from "@/lib/i18n/client";
import { fmt as fmtTemplate, type Dictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { moneyLocaleFor } from "@/lib/restaurant/menu-dishes/money";
import { IngredientConversions } from "./IngredientConversions";
import { invalidatePickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";
import Link from "next/link";
import { CAPABILITY_MESSAGES, type Capability } from "@/lib/auth/capabilities";
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
import {
  usesStatusLabel,
  type IngredientUseEntry,
} from "@/lib/restaurant/ingredient-uses";
import { normalizeUnit } from "@/lib/restaurant/units";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import {
  priceSourceLabel,
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
  /** Every dish and preparation that uses it; null = it could not be read. */
  usedIn: IngredientUseEntry[] | null;
  /** An active recipe (dish, or preparation an active dish uses) has a line with it. */
  inUse: boolean;
  /** Soft-hidden (050). Never true for an ingredient in use. */
  archived: boolean;
}

const UNITS = ["kg", "g", "l", "ml", "unit", "portion", "oz", "lb"];
const RED = "#d14343";
const GREEN = "#1f9d55";
const MUTED = "#8a92a3";

type D = Dictionary["menu"]["screens"]["ingredientes"];

function formatMoney(
  n: number,
  currency: string,
  lang: PreferredLanguage
): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat(moneyLocaleFor(lang, safe), {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(n) < 1 && n !== 0 ? 4 : 2,
  }).format(n);
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatQty(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
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

function categoryLabel(category: string | null, t: D): string {
  if (!category || category === "uncategorized") return t.noCategory;
  return category;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function errorOf(body: unknown, status: number, t: D): string {
  const b = body as { error?: unknown; details?: unknown } | null;
  return typeof b?.error === "string"
    ? b.error
    : fmtTemplate(t.httpError, { status });
}

function ingredientSort(t: D): SortColumn<IngredienteItem>[] {
  return [
    { key: "name", label: t.sortName, value: (i) => i.name },
    // A missing price is "Sin precio": last both ways, never 0.
    { key: "price", label: t.sortPrice, value: (i) => i.price },
    { key: "supplier", label: t.sortSupplier, value: (i) => i.supplier_name },
    {
      key: "sales",
      label: t.sortSales,
      value: (i) => i.sold_net_sales,
      agg: "sum",
    },
  ];
}

export function IngredientesScreen({
  items: initialItems,
  suppliers,
  currency,
  initialSelectedId,
  initialFilter,
  itemGroups = null,
  archiveAvailable = true,
  duplicates = NO_DUPLICATE_STATE,
  capabilities,
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
  /** What this person may do: the server's can() answers (capabilityFlags). */
  capabilities?: Partial<Record<Capability, boolean>>;
}) {
  const { d, lang } = useT();
  const t = d.menu.screens.ingredientes;
  const sortColumns = useMemo(() => ingredientSort(t), [t]);
  const allowed = (capability: Capability) =>
    capabilities?.[capability] ?? true;
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
      if (!res.ok) throw new Error(userErrorMessage(json, t.archiveFailed));
      const done = new Set(ids.filter((id) => !json.skipped?.includes(id)));
      setItems((prev) =>
        prev.map((i) => (done.has(i.id) ? { ...i, archived } : i))
      );
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : t.archiveFailedMany);
    } finally {
      setArchiving(false);
    }
  }
  const archiveAll = () => {
    const ids = items.filter((i) => !i.inUse && !i.archived).map((i) => i.id);
    if (window.confirm(fmtTemplate(t.confirmArchive, { n: ids.length }))) {
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
    canEdit: allowed("groups.manage"),
    onMergeSelected: allowed("ingredients.manage")
      ? (ids, clear) => setMergeSel({ ids, clear })
      : undefined,
    storageKey: "milton:ingredientes:abiertos",
    sortId: "ingredientes",
    sortColumns,
    searchPlaceholder: t.searchPlaceholder,
    searchText: (item) => item.supplier_name,
    categoryOf: (item) => item.category,
    emptyText: items.length === 0 ? t.emptyNone : t.emptyNoMatch,
    filters: (
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[12px] font-semibold"
          role="group"
          aria-label={t.usageGroup}
        >
          {(
            [
              ["en_uso", t.inUse, counts.en_uso],
              ["sin_uso", t.unused, counts.sin_uso],
              ["todos", t.all, counts.todos],
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
        <div className="flex gap-2" role="group" aria-label={t.filterGroup}>
          <FilterChip
            active={filter === "todos"}
            onClick={() => setFilter("todos")}
          >
            {t.all}
          </FilterChip>
          <FilterChip
            active={filter === "falta_precio"}
            onClick={() => setFilter("falta_precio")}
          >
            {fmtTemplate(t.missingPrice, { n: counts.falta_precio })}
          </FilterChip>
        </div>
        {counts.archivable > 0 && allowed("ingredients.manage") ? (
          <button
            type="button"
            onClick={archiveAll}
            disabled={archiving || !archiveAvailable}
            title={
              archiveAvailable ? t.archiveHint : d.menu.screens.notAvailableYet
            }
            className="rounded-lg border border-[#c6d3f5] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb] disabled:opacity-50"
          >
            {fmtTemplate(t.archiveUnused, { n: counts.archivable })}
          </button>
        ) : null}
        {!archiveAvailable && counts.sin_uso > 0 ? (
          <span className="text-[12px]" style={{ color: "#6b7280" }}>
            {d.menu.screens.notAvailableYet}
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
              : "hover:bg-[#f6f8fe]")
          }
        >
          <span className="min-w-0">
            <span className="line-clamp-2 break-words text-[13px] font-semibold text-[#151c2c]">
              {item.name}
              {dupQueue.flagged.has(item.id) ? (
                <span className="ml-1.5 rounded-md bg-[#efe8ff] px-1.5 py-0.5 text-[12px] font-semibold text-[#6d3fc4]">
                  {t.duplicateFlag}
                </span>
              ) : null}
            </span>
            <span
              className="block truncate text-[12px]"
              style={{ color: "#6b7280" }}
            >
              {item.supplier_name ?? "—"}
            </span>
          </span>
          <span className="shrink-0 text-right text-[13px] tabular-nums">
            {!item.inUse && item.price === null ? (
              <span
                className="font-semibold"
                style={{ color: "#6b7280" }}
                title={t.unusedHint}
              >
                {item.archived ? t.archived : t.unused}
              </span>
            ) : item.price === null ? (
              <span className="font-semibold" style={{ color: "#6b7280" }}>
                {t.missingPriceShort}
              </span>
            ) : (
              <span className="text-[#151c2c]">
                {formatMoney(item.price, currency, lang)}
                <span style={{ color: "#6b7280" }}>
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
        canEdit={allowed("ingredients.manage")}
        money={(n, unit) =>
          `${formatMoney(n, currency, lang)}${unit ? `/${unit}` : ""}`
        }
      />
      {mergeSel ? (
        <ManualMergeDialog
          q={dupQueue}
          items={items}
          ids={mergeSel.ids}
          money={(n, unit) =>
            `${formatMoney(n, currency, lang)}${unit ? `/${unit}` : ""}`
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
          <AddIngrediente
            onAdded={onAdded}
            canManage={allowed("ingredients.manage")}
          />
        </section>

        {selected ? (
          <IngredienteDetail
            key={selected.id}
            item={selected}
            suppliers={suppliers}
            currency={currency}
            onSaved={onSaved}
            archiveAvailable={archiveAvailable}
            canEditPrices={allowed("prices.edit")}
            canManage={allowed("ingredients.manage")}
            archiving={archiving}
            onArchive={(archived) => void setArchived([selected.id], archived)}
          />
        ) : (
          <section
            className="rounded-[14px] border border-[#eef0f4] bg-white p-6 text-[13px]"
            style={{ color: "#6b7280" }}
          >
            {t.pickOne}
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
  canManage,
}: {
  onAdded: (item: IngredienteItem) => void;
  canManage: boolean;
}) {
  const { d } = useT();
  const t = d.menu.screens.ingredientes;
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
        setError(errorOf(body, res.status, t));
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
        usedIn: [],
        inUse: false,
        archived: false,
      });
      setName("");
      setOpen(false);
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <p className="px-4 py-3 text-[12px]" style={{ color: "#6b7280" }}>
        {CAPABILITY_MESSAGES["ingredients.manage"]}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-3 text-left text-[13px] font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
      >
        {t.add}
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
          placeholder={t.namePlaceholder}
          aria-label={t.namePlaceholder}
          className="h-9 min-w-0 flex-1 rounded-lg border border-[#e3e7ee] px-3 text-[13px] outline-none focus:border-[#1B40C8]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          className="h-9 rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] font-semibold text-[#151c2c] disabled:opacity-50"
        >
          {saving ? t.adding : t.addButton}
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
  canEditPrices,
  canManage,
  archiving,
  onArchive,
}: {
  item: IngredienteItem;
  suppliers: SupplierOption[];
  currency: string;
  onSaved: (next: IngredienteItem) => void;
  archiveAvailable: boolean;
  canEditPrices: boolean;
  canManage: boolean;
  archiving: boolean;
  onArchive: (archived: boolean) => void;
}) {
  const { d, lang, locale } = useT();
  const t = d.menu.screens.ingredientes;
  const [priceDraft, setPriceDraft] = useState(
    item.price === null ? "" : formatMoney(item.price, currency, lang)
  );
  const [unitDraft, setUnitDraft] = useState(item.default_unit ?? "kg");
  const [categoryDraft, setCategoryDraft] = useState(
    item.category && item.category !== "uncategorized" ? item.category : ""
  );
  const [supplierDraft, setSupplierDraft] = useState(item.supplier_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsedPrice = parsePriceInput(priceDraft, lang);
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
      setError(t.invalidPrice);
      return;
    }
    // A supplier lives on the price entry: changing it alone needs a
    // price in the current unit to carry over.
    let entryPrice: number | null = priceChanged ? parsedPrice : null;
    if (entryPrice === null && supplierChanged) {
      if (item.price === null || unitMismatch) {
        setError(t.supplierNeedsPrice);
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
          setError(errorOf(body, res.status, t));
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
          setError(errorOf(body, res.status, t));
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
        };
        onSaved(next);
        setPriceDraft(formatMoney(newPrice, currency, lang));
      }
      setSaved(true);
    } catch {
      setError(t.saveFailed);
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
          <p className="text-[12px]" style={{ color: "#6b7280" }}>
            {categoryLabel(item.category, t)}
            {item.usedIn
              ? ` · ${fmtTemplate(item.usedIn.length === 1 ? t.inRecipesOne : t.inRecipesOther, { n: item.usedIn.length })}`
              : ""}
          </p>
          {!canManage ? (
            <p className="mt-1 text-[12px]" style={{ color: "#6b7280" }}>
              {CAPABILITY_MESSAGES["ingredients.manage"]}
            </p>
          ) : null}
          {!item.inUse ? (
            <p className="mt-1 text-[12px]" style={{ color: "#6b7280" }}>
              {item.archived ? t.archived : t.unused} · {t.unusedHint}{" "}
              {canManage ? (
                <button
                  type="button"
                  disabled={archiving || !archiveAvailable}
                  onClick={() => onArchive(!item.archived)}
                  className="font-semibold text-[#1b40c8] disabled:opacity-50"
                >
                  {item.archived ? t.restore : t.archive}
                </button>
              ) : null}
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
              {t.saved}
            </span>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || (!canManage && !canEditPrices)}
            className="h-9 rounded-lg px-5 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "#1b40c8" }}
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
        <div>
          <p className="text-[12px] font-semibold" style={{ color: "#6b7280" }}>
            {t.currentPrice}
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
              placeholder={t.missingPriceShort}
              aria-label={t.currentPrice}
              disabled={!canEditPrices}
              inputMode="decimal"
              className={
                "h-9 w-[180px] rounded-lg border border-[#c6d3f5] bg-white px-2.5 text-[15px] font-semibold tabular-nums text-[#151c2c] outline-none placeholder:font-normal placeholder:text-[#6b7280] focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20"
              }
            />
            <span
              className="text-[14px] font-semibold"
              style={{ color: "#6b7280" }}
            >
              /
            </span>
            <select
              value={unitDraft}
              onChange={(e) => {
                setUnitDraft(e.target.value);
                setSaved(false);
              }}
              aria-label={t.unit}
              disabled={!canManage}
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
              {fmtTemplate(t.storedPriceUnit, { unit: item.price_unit ?? "" })}
            </p>
          )}
          {/* R1-15a: a save that fails says why, right under the price. */}
          {error && (
            <p role="alert" className="mt-1 text-[12px]" style={{ color: RED }}>
              {error}
            </p>
          )}
          {priceDraft.trim() === "" && item.price === null && (
            <p className="mt-1 text-[12px]" style={{ color: "#6b7280" }}>
              {t.freeHint}
            </p>
          )}
        </div>
        <div>
          <p className="text-[12px] font-semibold" style={{ color: "#6b7280" }}>
            {t.change30}
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
          <p className="text-[12px] font-semibold" style={{ color: "#6b7280" }}>
            {t.category}
          </p>
          <input
            value={categoryDraft}
            onChange={(e) => {
              setCategoryDraft(e.target.value);
              setSaved(false);
            }}
            placeholder={t.noCategory}
            aria-label={t.category}
            disabled={!canManage}
            className="mt-2 h-9 w-[180px] rounded-md border border-[#e3e7ee] px-2 text-[13px] text-[#151c2c] outline-none focus:border-[#1B40C8]"
          />
        </div>
      </div>

      <p
        className="mt-4 flex flex-wrap items-center gap-1.5 text-[13px]"
        style={{ color: "#6b7280" }}
      >
        <span>{t.supplier}</span>
        <select
          value={supplierDraft}
          onChange={(e) => {
            setSupplierDraft(e.target.value);
            setSaved(false);
          }}
          aria-label={t.supplier}
          disabled={!canEditPrices}
          className="h-8 rounded-md border border-[#e3e7ee] bg-white px-1.5 text-[13px] text-[#151c2c]"
        >
          <option value="">—</option>
          {item.supplier_id &&
            !suppliers.some((s) => s.id === item.supplier_id) && (
              <option value={item.supplier_id}>
                {item.supplier_name ?? t.supplier}
              </option>
            )}
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span>
          ·{" "}
          {fmtTemplate(t.since, { date: formatDate(item.price_date, locale) })}
        </span>
        {item.source && (
          <span>
            ·{" "}
            {fmtTemplate(t.source, {
              source: priceSourceLabel(item.source, lang),
            })}
          </span>
        )}
      </p>

      <IngredientConversions
        key={item.id}
        ingredientId={item.id}
        ingredientName={item.name}
        priceUnit={item.price_unit ?? item.default_unit}
        usedUnits={[
          ...new Set(
            (item.usedIn ?? []).flatMap((u) => (u.unit ? [u.unit] : []))
          ),
        ]}
        price={item.price}
        currency={currency}
        canEdit={canEditPrices}
      />

      <h3 className="mt-6 text-[14px] font-bold text-[#151c2c]">{t.usedIn}</h3>
      <UsesList usedIn={item.usedIn} />
    </section>
  );
}

/** "Se usa en": the one list the counters come from. */
export function UsesList({ usedIn }: { usedIn: IngredientUseEntry[] | null }) {
  const { d, locale, lang } = useT();
  const t = d.menu.screens.ingredientes;
  if (usedIn === null)
    return (
      <p className="mt-2 text-[13px]" style={{ color: "#6b7280" }}>
        {t.usesUnreadable}
      </p>
    );
  if (usedIn.length === 0)
    return (
      <p className="mt-2 text-[13px]" style={{ color: "#6b7280" }}>
        {t.usesNone}
      </p>
    );
  return (
    <table className="mt-2 w-full text-[13px]">
      <thead>
        <tr
          className="border-b border-[#eef0f4] text-left text-[12px]"
          style={{ color: "#6b7280" }}
        >
          <th className="py-2 font-semibold">{t.colRecipe}</th>
          <th className="py-2 font-semibold">{t.colStatus}</th>
          <th className="py-2 text-right font-semibold">{t.colQty}</th>
        </tr>
      </thead>
      <tbody>
        {usedIn.map((u) => (
          <tr key={u.key} className="border-b border-[#f3f4f7] last:border-0">
            <td className="py-2">
              <Link
                href={u.href}
                className="font-semibold text-[#151c2c] hover:text-[#1B40C8] hover:underline"
              >
                {u.name}
              </Link>
              <span className="ml-2 text-[12px]" style={{ color: "#6b7280" }}>
                {u.kind === "preparacion" ? t.kindPrep : t.kindDish}
                {u.via ? ` · ${u.via}` : ""}
              </span>
            </td>
            <td className="py-2">
              <span className="rounded-full bg-[#f3f4f7] px-2 py-0.5 text-[12px] font-semibold text-[#5b6476]">
                {usesStatusLabel(u.status, lang)}
              </span>
            </td>
            <td className="py-2 text-right tabular-nums text-[#151c2c]">
              {u.qty !== null
                ? `${formatQty(u.qty, locale)} ${u.unit ?? ""}`.trim()
                : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
