// components/restaurant/IngredientsPage.tsx
//
// Foundation UI for raw ingredients + manual cost entries.
//
// Two cards:
//   1. Add ingredient (no cost) — minimal catalog row.
//   2. Add cost entry (manual) — observation that the costing engine
//      reads via ingredient_cost_entries (server-side normalisation).
//
// The list shows the latest cost per ingredient. We never invent a cost:
// "pending cost entry" appears when no entry exists, and that exact
// status is what propagates upstream into the menu page.

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Carrot, Plus, Receipt, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IngredientLatestCostRow } from "@/lib/restaurant/menu-recipes-server";

const DEFAULT_UNITS = ["kg", "g", "l", "ml", "unit", "portion", "oz", "lb"];

interface SupplierOption {
  id: string;
  name: string;
}

export function IngredientsPage({
  ingredients,
  suppliers,
}: {
  ingredients: IngredientLatestCostRow[];
  suppliers: SupplierOption[];
}) {
  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-8 max-w-screen-2xl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Carrot className="h-6 w-6 text-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">Ingredients</h1>
            <Badge className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0">
              Foundation
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="gap-2">
              <Link href="/dashboard/restaurant/costs/upload">
                <Upload className="h-4 w-4" />
                Import costs
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/restaurant/menu">Back to Menu</Link>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground -mt-4 max-w-3xl">
          Raw materials used as inputs to prepared components and menu recipes.
          Add manual cost entries to start the cost engine; supplier invoices
          will feed the same table automatically in a later milestone.
        </p>

        {/* Add ingredient ---------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add ingredient
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CreateIngredientForm />
          </CardContent>
        </Card>

        {/* Add cost entry --------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4 text-orange-500" />
              Add manual cost entry
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ingredients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add at least one ingredient above before recording a cost.
              </p>
            ) : (
              <AddCostEntryForm
                ingredients={ingredients}
                suppliers={suppliers}
              />
            )}
          </CardContent>
        </Card>

        {/* Ingredients table ------------------------------------------ */}
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Ingredients{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({ingredients.length})
            </span>
          </h2>
          {ingredients.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No ingredients yet. Add one above to start the catalog.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/40">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Ingredient</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Default unit</th>
                        <th className="px-4 py-3 font-medium">
                          Latest unit cost
                        </th>
                        <th className="px-4 py-3 font-medium">Cost date</th>
                        <th className="px-4 py-3 font-medium">Supplier</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingredients.map((ing, i) => (
                        <IngredientRow
                          key={ing.id}
                          ing={ing}
                          striped={i % 2 === 1}
                          suppliers={suppliers}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function formatCurrency(n: number, currency: string): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  // Use up to 4 fractional digits so prices like 0.005 / g still read.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function CreateIngredientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [defaultUnit, setDefaultUnit] = useState("kg");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/restaurant/ingredients", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            category: category.trim() || null,
            default_unit: defaultUnit,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        setName("");
        setCategory("");
        setDefaultUnit("kg");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Beef brisket"
          className="h-9"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Category</span>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Protein, Dairy, Produce…"
          className="h-9"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Default unit</span>
        <select
          value={defaultUnit}
          onChange={(e) => setDefaultUnit(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {DEFAULT_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 md:col-span-4">
        <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Add ingredient"}
        </Button>
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Manual cost entry form. Server computes unit_cost and the normalized
 * projection — we just collect the supplier observation and a date.
 *
 * Default unit follows the selected ingredient's default_unit so the
 * common case (matching units) is one click less.
 */
function AddCostEntryForm({
  ingredients,
  suppliers,
}: {
  ingredients: IngredientLatestCostRow[];
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [costDate, setCostDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(ingredients[0]?.default_unit ?? "kg");
  const [totalCost, setTotalCost] = useState("");
  const [currency, setCurrency] = useState("MXN");
  const [supplierId, setSupplierId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Whenever the user picks a different ingredient, pre-fill the unit
  // dropdown with that ingredient's default — saves a click in the
  // common case.
  const handleIngredientChange = (id: string) => {
    setIngredientId(id);
    const next = ingredients.find((i) => i.id === id);
    if (next?.default_unit) setUnit(next.default_unit);
  };

  const submit = () => {
    setError(null);
    setSuccess(null);
    const qNum = Number(quantity);
    const tNum = Number(totalCost);
    if (!ingredientId) {
      setError("Pick an ingredient.");
      return;
    }
    if (!Number.isFinite(qNum) || qNum <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (!Number.isFinite(tNum) || tNum < 0) {
      setError("Total cost must be a non-negative number.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/restaurant/ingredient-costs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredient_id: ingredientId,
            cost_date: costDate,
            quantity: qNum,
            unit,
            total_cost: tNum,
            currency,
            supplier_id: supplierId || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (typeof body?.error === "string"
              ? body.error
              : `HTTP ${res.status}`) +
              (typeof body?.details === "string" ? ` — ${body.details}` : "")
          );
          return;
        }
        const okMsg =
          body?.normalization_ok === false
            ? `Saved, but unit ${unit} couldn't be normalized to ${body?.target_unit}. The engine will flag downstream recipes as missing_unit_conversion.`
            : "Cost entry saved.";
        setSuccess(okMsg);
        setQuantity("");
        setTotalCost("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-xs text-muted-foreground">Ingredient</span>
        <select
          value={ingredientId}
          onChange={(e) => handleIngredientChange(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {i.default_unit ? ` (${i.default_unit})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Cost date</span>
        <Input
          type="date"
          value={costDate}
          onChange={(e) => setCostDate(e.target.value)}
          className="h-9"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Quantity</span>
        <Input
          type="number"
          min={0}
          step="0.0001"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="10"
          className="h-9"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Unit</span>
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {DEFAULT_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Total cost</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={totalCost}
          onChange={(e) => setTotalCost(e.target.value)}
          placeholder="3700"
          className="h-9"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Currency</span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="MXN">MXN</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          Supplier (optional){" "}
          <Link
            href="/dashboard/restaurant/suppliers"
            className="text-primary hover:underline"
            title="Manage suppliers"
          >
            Manage suppliers ↗
          </Link>
        </span>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 md:col-span-6 flex-wrap">
        <Button size="sm" onClick={submit} disabled={pending || !ingredientId}>
          {pending ? "Saving…" : "Save cost entry"}
        </Button>
        {success && (
          <span className="text-xs text-green-700 dark:text-green-300">
            {success}
          </span>
        )}
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          Unit cost is derived (total / quantity) and normalized to the
          ingredient&apos;s default unit when convertible.
        </span>
      </div>
    </div>
  );
}

/**
 * One ingredient row. The default-unit cell is an inline-editable select
 * that PATCHes the ingredient on change — this is the only correction
 * path today for the most common mistake (saving a unit-based item like
 * "Burger bun" with the kg default).
 *
 * The latest-cost cell also exposes a "delete entry" link when a cost
 * exists, since changing default_unit doesn't retroactively re-normalise
 * older cost rows; the user often wants to drop the bad observation and
 * re-enter against the new canonical unit.
 *
 * UI is intentionally tiny — no edit mode, no Save buttons. Each control
 * fires its own request and uses router.refresh() to re-hydrate the
 * server page (so the latest-cost row reflects the new canonical state).
 */
function IngredientRow({
  ing,
  striped,
  suppliers,
}: {
  ing: IngredientLatestCostRow;
  striped: boolean;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [savingUnit, startUnitTx] = useTransition();
  const [savingCategory, startCategoryTx] = useTransition();
  const [deletingEntry, startDeleteTx] = useTransition();
  const [unitError, setUnitError] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState(ing.category ?? "");
  const [editingCategory, setEditingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onChangeUnit = (next: string) => {
    if (next === ing.default_unit) return;
    setUnitError(null);
    startUnitTx(async () => {
      try {
        const res = await fetch(`/api/restaurant/ingredients/${ing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ default_unit: next }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUnitError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        router.refresh();
      } catch (err) {
        setUnitError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  const onSaveCategory = () => {
    setCategoryError(null);
    startCategoryTx(async () => {
      try {
        const res = await fetch(`/api/restaurant/ingredients/${ing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: categoryDraft.trim() || null }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCategoryError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        setEditingCategory(false);
        router.refresh();
      } catch (err) {
        setCategoryError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  const onDeleteLatest = () => {
    if (!ing.latest) return;
    if (
      !confirm(
        `Delete the latest cost entry for “${ing.name}” (${ing.latest.cost_date})?\n\nThis only removes the most recent entry. Older entries (if any) stay; the engine will fall back to the next-newest.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    startDeleteTx(async () => {
      try {
        const res = await fetch(
          `/api/restaurant/ingredient-costs?id=${encodeURIComponent(ing.latest!.id)}`,
          { method: "DELETE", credentials: "include" }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDeleteError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        router.refresh();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  // Mismatch hint: when the displayed cost's normalized_unit doesn't
  // match the ingredient's default_unit, the user probably ran into the
  // exact bug we're fixing. Surface it inline so they know what to do.
  const unitMismatch =
    ing.latest &&
    ing.default_unit &&
    ing.latest.normalized_unit !== ing.default_unit;

  return (
    <tr
      className={
        (striped ? "bg-muted/20" : "bg-background") +
        " border-b border-border hover:bg-muted/30"
      }
    >
      <td className="px-4 py-3 font-medium">{ing.name}</td>
      <td className="px-4 py-3">
        {editingCategory ? (
          <div className="flex items-center gap-1">
            <Input
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveCategory();
                if (e.key === "Escape") setEditingCategory(false);
              }}
              className="h-7 text-xs w-32"
              autoFocus
              placeholder="e.g. Protein"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onSaveCategory}
              disabled={savingCategory}
            >
              ✓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setEditingCategory(false)}
            >
              ✕
            </Button>
            {categoryError && (
              <span className="text-xs text-red-700">{categoryError}</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline text-left"
            onClick={() => {
              setCategoryDraft(ing.category ?? "");
              setEditingCategory(true);
            }}
            title="Click to edit category"
          >
            {ing.category ?? (
              <span className="text-amber-600 dark:text-amber-400">
                — add category
              </span>
            )}
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <select
          value={ing.default_unit ?? ""}
          onChange={(e) => onChangeUnit(e.target.value)}
          disabled={savingUnit}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          aria-label={`Default unit for ${ing.name}`}
        >
          {/* Render the current value first even if it isn't in the
              canonical list (legacy free-text values). */}
          {ing.default_unit && !DEFAULT_UNITS.includes(ing.default_unit) && (
            <option value={ing.default_unit}>{ing.default_unit}</option>
          )}
          {DEFAULT_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {unitError && (
          <span className="block text-xs text-red-700 dark:text-red-300 mt-1">
            {unitError}
          </span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {ing.latest ? (
          <>
            {formatCurrency(
              ing.latest.normalized_unit_cost,
              ing.latest.currency
            )}{" "}
            <span className="text-xs text-muted-foreground">
              / {ing.latest.normalized_unit}
            </span>
            {unitMismatch && (
              <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Cost is in {ing.latest.normalized_unit} but default unit is{" "}
                {ing.default_unit}. Delete the entry and re-add against the
                correct unit.
              </div>
            )}
          </>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            pending cost entry
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {ing.latest?.cost_date ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {ing.latest?.supplier_name ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
        {ing.latest?.source_type ?? "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 justify-end">
          {ing.latest && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDeleteLatest}
              disabled={deletingEntry}
              className="text-muted-foreground hover:text-red-700"
            >
              Delete entry
            </Button>
          )}
          {deleteError && (
            <span className="text-xs text-red-700 dark:text-red-300">
              {deleteError}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
