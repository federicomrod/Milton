// components/restaurant/ComponentRecipeBuilder.tsx
//
// Builder UI for prepared-component recipes (Smoked Brisket = 10 kg raw
// brisket → 6.5 kg yield). Mirrors the menu-item recipe builder for
// consistency, with three extra header fields specific to components:
//   * output_quantity / output_unit  — "this recipe produces 6.5 kg of …"
//   * yield_percentage               — optional shrinkage hint
//
// Saves POST to /api/restaurant/recipes/component/:id with the same
// "replace inputs" contract as the menu-item builder.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Plus, Trash2, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InputType = "ingredient" | "component";

interface DraftInput {
  uid: string;
  input_type: InputType;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: string;
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

interface ComponentRow {
  id: string;
  name: string;
  category: string | null;
  output_unit: string;
  status: string | null;
}

interface RecipeRow {
  id: string;
  name: string | null;
  output_quantity: number | null;
  output_unit: string | null;
  yield_percentage: number | null;
  status: string | null;
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

export function ComponentRecipeBuilder({
  component,
  recipe,
  inputs: persistedInputs,
  ingredients,
  components,
}: {
  component: ComponentRow;
  recipe: RecipeRow | null;
  inputs: PersistedInput[];
  ingredients: IngredientOption[];
  components: ComponentOption[];
}) {
  const router = useRouter();

  const [status, setStatus] = useState<"draft" | "active" | "archived">(
    (recipe?.status as "draft" | "active" | "archived" | null) ?? "draft"
  );
  const [outputQty, setOutputQty] = useState<string>(
    recipe?.output_quantity != null ? String(recipe.output_quantity) : ""
  );
  const [outputUnit, setOutputUnit] = useState<string>(
    recipe?.output_unit ?? component.output_unit
  );
  const [yieldPct, setYieldPct] = useState<string>(
    recipe?.yield_percentage != null ? String(recipe.yield_percentage) : ""
  );

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
    const outQ = Number(outputQty);
    if (!Number.isFinite(outQ) || outQ <= 0) {
      setSaveResult({
        kind: "error",
        message: "Output quantity must be a positive number.",
      });
      return;
    }
    if (!outputUnit.trim()) {
      setSaveResult({ kind: "error", message: "Output unit is required." });
      return;
    }
    let yieldNum: number | null = null;
    if (yieldPct.trim() !== "") {
      yieldNum = Number(yieldPct);
      if (!Number.isFinite(yieldNum) || yieldNum <= 0 || yieldNum > 100) {
        setSaveResult({
          kind: "error",
          message: "Yield % must be between 0 and 100 (or leave blank).",
        });
        return;
      }
    }
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
          `/api/restaurant/recipes/component/${component.id}`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status,
              output_quantity: outQ,
              output_unit: outputUnit.trim(),
              yield_percentage: yieldNum,
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
          const message = [
            top,
            pgMessage ? `· ${pgMessage}` : null,
            pgCode ? `(code ${pgCode})` : null,
          ]
            .filter(Boolean)
            .join(" ");
          console.error("[ComponentRecipeBuilder save]", body);
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
          <Sparkles className="h-6 w-6 text-orange-500" />
          <h1 className="text-2xl font-bold tracking-tight">
            {component.name}
          </h1>
          {component.category && (
            <Badge variant="outline" className="text-xs">
              {component.category}
            </Badge>
          )}
          {component.status && (
            <Badge variant="outline" className="text-xs">
              {component.status}
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Component recipe</CardTitle>
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
                  Output quantity
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={outputQty}
                  onChange={(e) => setOutputQty(e.target.value)}
                  placeholder="6.5"
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Output unit
                </span>
                <Input
                  value={outputUnit}
                  onChange={(e) => setOutputUnit(e.target.value)}
                  placeholder={component.output_unit}
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Yield % (optional)
                </span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={yieldPct}
                  onChange={(e) => setYieldPct(e.target.value)}
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
                        ? "No other components available — components can't reference themselves."
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
                  No inputs yet. Add ingredients and/or sub-components above.
                </p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((row) => (
                    <ComponentRecipeInputRow
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
                {saving ? "Saving…" : "Save component recipe"}
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
                Replaces the full input list. Cost-per-output-unit will
                recompute automatically once ingredient costs are available.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ComponentRecipeInputRow({
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
            {components.length === 0 && (
              <option value="">No other components</option>
            )}
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
          step="0.0001"
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
