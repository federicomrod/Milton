// components/restaurant/RecipeBuilder.tsx
//
// Foundation recipe builder. The user adds rows (each either an
// ingredient OR a prepared component) with quantity + unit, picks a
// status (draft / active / archived), and clicks Save. The whole input
// list is sent to PUT /api/restaurant/recipes/menu-item/:id which
// replaces the persisted set in one shot.
//
// Cost math is intentionally absent — recipes are the schema for costing
// that lands in a later milestone.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Plus, Trash2, Save, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InputType = "ingredient" | "component";

interface DraftInput {
  /** Stable client-side key — never sent to the server. */
  uid: string;
  input_type: InputType;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: string; // string so the field can be temporarily empty
  unit: string;
  notes: string;
}

interface IngredientOption {
  id: string;
  name: string;
  default_unit: string | null;
}

interface ComponentOption {
  id: string;
  name: string;
  output_unit: string;
  status: string;
}

interface MenuItem {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  currency: string | null;
  status: string | null;
}

interface Recipe {
  id: string;
  status: string | null;
  serving_quantity: number | null;
  serving_unit: string | null;
  notes: string | null;
}

interface PersistedInput {
  id: string;
  input_type: InputType;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

export function RecipeBuilder({
  menuItem,
  recipe,
  inputs: persistedInputs,
  ingredients,
  components,
}: {
  menuItem: MenuItem;
  recipe: Recipe | null;
  inputs: PersistedInput[];
  ingredients: IngredientOption[];
  components: ComponentOption[];
}) {
  const router = useRouter();

  const [status, setStatus] = useState<"draft" | "active" | "archived">(
    (recipe?.status as "draft" | "active" | "archived" | null) ?? "draft"
  );
  const [servingQuantity, setServingQuantity] = useState<string>(
    recipe?.serving_quantity != null ? String(recipe.serving_quantity) : "1"
  );
  const [servingUnit, setServingUnit] = useState<string>(
    recipe?.serving_unit ?? "portion"
  );
  const [notes, setNotes] = useState<string>(recipe?.notes ?? "");

  const [drafts, setDrafts] = useState<DraftInput[]>(() =>
    persistedInputs.map((p) => ({
      uid: p.id,
      input_type: p.input_type,
      ingredient_id: p.ingredient_id,
      component_id: p.component_id,
      quantity: String(p.quantity),
      unit: p.unit,
      notes: p.notes ?? "",
    }))
  );

  const [saving, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const addRow = (type: InputType) => {
    const uid = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (type === "ingredient") {
      const def = ingredients[0];
      setDrafts((d) => [
        ...d,
        {
          uid,
          input_type: "ingredient",
          ingredient_id: def?.id ?? null,
          component_id: null,
          quantity: "",
          unit: def?.default_unit ?? "kg",
          notes: "",
        },
      ]);
    } else {
      const def = components[0];
      setDrafts((d) => [
        ...d,
        {
          uid,
          input_type: "component",
          ingredient_id: null,
          component_id: def?.id ?? null,
          quantity: "",
          unit: def?.output_unit ?? "kg",
          notes: "",
        },
      ]);
    }
  };

  const updateRow = (uid: string, patch: Partial<DraftInput>) => {
    setDrafts((d) =>
      d.map((row) => (row.uid === uid ? { ...row, ...patch } : row))
    );
  };

  const removeRow = (uid: string) => {
    setDrafts((d) => d.filter((row) => row.uid !== uid));
  };

  const save = () => {
    setSaveResult({ kind: "idle" });
    // Client-side validation before we POST — keeps the API error path
    // cleaner since the server only catches things we couldn't here.
    for (const row of drafts) {
      if (row.input_type === "ingredient" && !row.ingredient_id) {
        setSaveResult({
          kind: "error",
          message: "Pick an ingredient for every ingredient row.",
        });
        return;
      }
      if (row.input_type === "component" && !row.component_id) {
        setSaveResult({
          kind: "error",
          message: "Pick a component for every component row.",
        });
        return;
      }
      const q = Number(row.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        setSaveResult({
          kind: "error",
          message: "Every row needs a positive quantity.",
        });
        return;
      }
      if (!row.unit.trim()) {
        setSaveResult({ kind: "error", message: "Every row needs a unit." });
        return;
      }
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/restaurant/recipes/menu-item/${menuItem.id}`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status,
              serving_quantity: Number(servingQuantity) || 1,
              serving_unit: servingUnit,
              notes,
              inputs: drafts.map((d) => ({
                input_type: d.input_type,
                ingredient_id:
                  d.input_type === "ingredient" ? d.ingredient_id : null,
                component_id:
                  d.input_type === "component" ? d.component_id : null,
                quantity: Number(d.quantity),
                unit: d.unit,
                notes: d.notes || undefined,
              })),
            }),
          }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Surface the full Postgres context when present. The API
          // returns `pg: { message, code, details, hint }` for DB errors;
          // we render whichever sub-fields are populated so we can see
          // the real cause (e.g. "null value in column 'name' violates
          // not-null constraint") instead of just our top-line label.
          const top =
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
          const pgMessage =
            typeof body?.pg?.message === "string"
              ? body.pg.message
              : typeof body?.details === "string"
                ? body.details
                : null;
          const pgCode =
            typeof body?.pg?.code === "string" ? body.pg.code : null;
          const pgHint =
            typeof body?.pg?.hint === "string" ? body.pg.hint : null;
          const message = [
            top,
            pgMessage ? `· ${pgMessage}` : null,
            pgCode ? `(code ${pgCode})` : null,
            pgHint ? `— ${pgHint}` : null,
          ]
            .filter(Boolean)
            .join(" ");
          console.error("[RecipeBuilder save] server error:", body);
          setSaveResult({ kind: "error", message });
          return;
        }
        setSaveResult({ kind: "ok" });
        router.refresh();
      } catch (err) {
        setSaveResult({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    });
  };

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-6 max-w-5xl">
        <Link
          href="/dashboard/restaurant/menu"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Menu & Recipes
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <BookOpen className="h-6 w-6 text-orange-500" />
          <h1 className="text-2xl font-bold tracking-tight">{menuItem.name}</h1>
          {menuItem.category && (
            <Badge variant="outline" className="text-xs">
              {menuItem.category}
            </Badge>
          )}
          {menuItem.status && (
            <Badge variant="outline" className="text-xs">
              {menuItem.status}
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recipe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Serving qty
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={servingQuantity}
                  onChange={(e) => setServingQuantity(e.target.value)}
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Serving unit
                </span>
                <Input
                  value={servingUnit}
                  onChange={(e) => setServingUnit(e.target.value)}
                  placeholder="portion"
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1 md:col-span-1">
                <span className="text-xs text-muted-foreground">Notes</span>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="—"
                  className="h-9"
                />
              </label>
            </div>

            {/* Inputs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Inputs</h3>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => addRow("ingredient")}
                    disabled={ingredients.length === 0}
                    title={
                      ingredients.length === 0
                        ? "Create at least one ingredient first"
                        : "Add an ingredient row"
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ingredient
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => addRow("component")}
                    disabled={components.length === 0}
                    title={
                      components.length === 0
                        ? "Create at least one component first"
                        : "Add a component row"
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Component
                  </Button>
                </div>
              </div>

              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No inputs yet. Add ingredients and/or prepared components
                  above.
                </p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((row) => (
                    <RecipeInputRow
                      key={row.uid}
                      row={row}
                      ingredients={ingredients}
                      components={components}
                      onChange={(patch) => updateRow(row.uid, patch)}
                      onRemove={() => removeRow(row.uid)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border">
              <Button
                size="sm"
                onClick={save}
                disabled={saving}
                className="gap-1"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save recipe"}
              </Button>
              {saveResult.kind === "ok" && (
                <span className="text-sm text-green-700 dark:text-green-300">
                  Recipe saved.
                </span>
              )}
              {saveResult.kind === "error" && (
                <span className="text-sm text-red-700 dark:text-red-300">
                  {saveResult.message}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Replaces the full input list for this menu item.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecipeInputRow({
  row,
  ingredients,
  components,
  onChange,
  onRemove,
}: {
  row: DraftInput;
  ingredients: IngredientOption[];
  components: ComponentOption[];
  onChange: (patch: Partial<DraftInput>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-md border border-border p-3 bg-muted/20">
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-xs text-muted-foreground">Type</span>
        <select
          value={row.input_type}
          onChange={(e) => {
            const next = e.target.value as InputType;
            // Reset the foreign key when the type switches so we never
            // submit a stale id of the wrong kind.
            if (next === "ingredient") {
              const def = ingredients[0];
              onChange({
                input_type: next,
                ingredient_id: def?.id ?? null,
                component_id: null,
                unit: def?.default_unit ?? row.unit,
              });
            } else {
              const def = components[0];
              onChange({
                input_type: next,
                component_id: def?.id ?? null,
                ingredient_id: null,
                unit: def?.output_unit ?? row.unit,
              });
            }
          }}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="ingredient">Ingredient</option>
          <option value="component">Component</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 md:col-span-4">
        <span className="text-xs text-muted-foreground">Source</span>
        {row.input_type === "ingredient" ? (
          <select
            value={row.ingredient_id ?? ""}
            onChange={(e) =>
              onChange({ ingredient_id: e.target.value || null })
            }
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {ingredients.length === 0 && (
              <option value="">No ingredients</option>
            )}
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.default_unit ? ` (${i.default_unit})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={row.component_id ?? ""}
            onChange={(e) => onChange({ component_id: e.target.value || null })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {components.length === 0 && <option value="">No components</option>}
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.output_unit}) · {c.status}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-xs text-muted-foreground">Quantity</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className="h-9"
        />
      </label>

      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-xs text-muted-foreground">Unit</span>
        <Input
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          className="h-9"
        />
      </label>

      <label className="flex flex-col gap-1 md:col-span-1">
        <span className="text-xs text-muted-foreground">Notes</span>
        <Input
          value={row.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="—"
          className="h-9"
        />
      </label>

      <div className="md:col-span-1 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label="Remove row"
          className="text-muted-foreground hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
