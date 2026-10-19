"use client";

// components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx
//
// Manager review UI for recipe drafts: list drafts, edit ingredients/portions/units,
// add/remove lines, pick menu item, confirm or reject. English UI (cook-facing bot
// stays Spanish). Confirm disabled until all lines resolved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IngredientCombobox,
  type ComboIngredient,
  type CreateOutcome,
} from "./IngredientCombobox";
import { InlinePriceEditor } from "./InlinePriceEditor";
import {
  computeDraftCost,
  type CostLineInput,
  type DraftCost,
  type PriceInfo,
} from "@/lib/restaurant/kitchen-draft-costing";
import {
  normalizeKitchenName,
  suggestIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { normalizeUnit } from "@/lib/restaurant/units";

interface DraftLine {
  id: string;
  raw_name: string;
  ingredient_id: string | null;
  ingredient_name: string | null;
  total_quantity: number | null;
  unit: string | null;
  per_portion_quantity: number | null;
  confidence: string;
  line_cost: number | null;
}

interface Draft {
  id: string;
  dish_name: string;
  portions: number | null;
  status: string;
  confidence: string;
  per_portion_cost: number | null;
  currency: string | null;
  created_at: string;
  staff_name: string;
  location_name: string;
  lines: DraftLine[];
}

interface Ingredient {
  id: string;
  name: string;
  default_unit?: string | null;
  /** Current price per unit (the shared latest entry); null = Sin precio. */
  price?: PriceInfo | null;
}

interface MenuItem {
  id: string;
  name: string;
  selling_price: number | null;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-red-100 text-red-800",
};

export function KitchenRecipeDraftsCard({
  canManage,
  locations,
  focusDraftId,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
  focusDraftId?: string | null;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [editedDraft, setEditedDraft] = useState<Draft | null>(null);
  const [editedLines, setEditedLines] = useState<DraftLine[]>([]);
  const [selectedMenuItem, setSelectedMenuItem] = useState<string>("");
  const [newSellingPrice, setNewSellingPrice] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  // Which line / draft has its «Editar precio» form open.
  const [priceEditLine, setPriceEditLine] = useState<string | null>(null);
  const [pricesOpenFor, setPricesOpenFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (locationId) params.set("location_id", locationId);
      const res = await fetch(
        `/api/restaurant/kitchen/recipe-drafts?${params}`
      );
      if (cancelled) return;
      if (!res.ok) {
        setError("No se pudieron cargar los borradores.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setError(null);
      const next = (data.drafts ?? []) as Draft[];
      setDrafts(next);
      if (focusDraftId) {
        const hit = next.find((d) => d.id === focusDraftId);
        if (hit) {
          setSelectedDraft(hit);
          setEditedDraft(JSON.parse(JSON.stringify(hit)));
          setEditedLines(JSON.parse(JSON.stringify(hit.lines)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, reloadKey, focusDraftId]);

  const loadIngredients = useCallback(async () => {
    const res = await fetch("/api/restaurant/kitchen/ingredients");
    if (res.ok) {
      const data = await res.json();
      setIngredients(data.ingredients ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/restaurant/kitchen/ingredients");
      if (cancelled || !res.ok) return;
      const data = await res.json();
      if (!cancelled) setIngredients(data.ingredients ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/restaurant/menu-items");
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        setMenuItems(data.menu_items ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openEditor = (draft: Draft) => {
    setSelectedDraft(draft);
    setEditedDraft(JSON.parse(JSON.stringify(draft)));
    setEditedLines(JSON.parse(JSON.stringify(draft.lines)));
    setSelectedMenuItem("");
    setNewSellingPrice("");
  };

  const closeEditor = () => {
    setSelectedDraft(null);
    setEditedDraft(null);
    setEditedLines([]);
    setSelectedMenuItem("");
    setNewSellingPrice("");
  };

  const handleConfirm = async () => {
    if (!editedDraft) return;

    const menuItemId =
      selectedMenuItem === "new" ? undefined : selectedMenuItem || undefined;
    const sellingPrice =
      selectedMenuItem === "new" && newSellingPrice
        ? parseFloat(newSellingPrice)
        : undefined;

    const linePayload = editedLines.map((l) => ({
      id: l.id,
      raw_name: l.raw_name || l.ingredient_name || "ingredient",
      ingredient_id: l.ingredient_id,
      total_quantity: l.total_quantity,
      unit: l.unit,
    }));

    const patchRes = await fetch(
      `/api/restaurant/kitchen/recipe-drafts/${editedDraft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: editedDraft.dish_name,
          portions: editedDraft.portions,
          menu_item_id: menuItemId,
          lines: linePayload,
        }),
      }
    );
    if (!patchRes.ok) {
      const data = await patchRes.json().catch(() => ({}));
      setError(data.error ?? "No se pudieron guardar los cambios.");
      return;
    }

    const patchData = await patchRes.json().catch(() => ({}));
    const savedLines: DraftLine[] = Array.isArray(patchData.lines)
      ? patchData.lines
      : editedLines;

    const res = await fetch(
      `/api/restaurant/kitchen/recipe-drafts/${editedDraft.id}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: editedDraft.dish_name,
          portions: editedDraft.portions,
          menu_item_id: menuItemId,
          selling_price: sellingPrice,
          lines: savedLines.map((l) => ({
            id: l.id,
            ingredient_id: l.ingredient_id,
            total_quantity: l.total_quantity,
            unit: l.unit,
          })),
        }),
      }
    );
    if (res.ok) {
      closeEditor();
      setReloadKey((k) => k + 1);
    } else {
      const data = await res.json();
      setError(data.error ?? "No se pudo confirmar.");
    }
  };

  const handleReject = async (draftId: string) => {
    const res = await fetch(
      `/api/restaurant/kitchen/recipe-drafts/${draftId}/reject`,
      {
        method: "POST",
      }
    );
    if (res.ok) {
      setReloadKey((k) => k + 1);
    }
  };

  /** Remember that a name the cook said means this ingredient (this company). */
  const rememberAlias = (rawName: string, ing: ComboIngredient) => {
    const raw = rawName.trim();
    if (!raw || normalizeKitchenName(raw) === normalizeKitchenName(ing.name)) {
      return;
    }
    void fetch("/api/restaurant/kitchen/ingredient-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_name: raw, ingredient_id: ing.id }),
    }).catch(() => undefined);
  };

  const updateLineIngredient = (index: number, ing: ComboIngredient) => {
    const previous = editedLines[index];
    const newLines = [...editedLines];
    newLines[index] = {
      ...newLines[index],
      ingredient_id: ing.id,
      ingredient_name: ing.name,
    };
    setEditedLines(newLines);
    // Accepting a suggestion or picking another ingredient for the cook's own
    // words teaches Milton that name for next time.
    if (previous && previous.ingredient_id !== ing.id) {
      rememberAlias(previous.raw_name, ing);
    }
  };

  /** «+ Crear "texto"»: a new ingredient WITHOUT a price (duplicates are refused). */
  const createIngredient = async (
    index: number,
    name: string
  ): Promise<CreateOutcome> => {
    const lineUnit = editedLines[index]?.unit;
    const res = await fetch("/api/restaurant/kitchen/ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        unit: lineUnit && normalizeUnit(lineUnit) ? lineUnit : undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      existing?: ComboIngredient;
      ingredient?: ComboIngredient;
    };
    if (res.ok && json.ingredient) {
      await loadIngredients();
      return {
        ok: true,
        ingredient: { id: json.ingredient.id, name: json.ingredient.name },
      };
    }
    if (res.status === 409 && json.existing) {
      return { ok: false, similar: json.existing };
    }
    return { ok: false, error: json.error };
  };

  const updateLineQuantity = (index: number, quantity: number | null) => {
    const newLines = [...editedLines];
    newLines[index] = {
      ...newLines[index],
      total_quantity: quantity,
      per_portion_quantity:
        quantity !== null && editedDraft?.portions
          ? quantity / editedDraft.portions
          : null,
    };
    setEditedLines(newLines);
  };

  const updateLineUnit = (index: number, unit: string) => {
    const newLines = [...editedLines];
    newLines[index] = { ...newLines[index], unit };
    setEditedLines(newLines);
  };

  const addLine = () => {
    setEditedLines([
      ...editedLines,
      {
        id: `new-${Date.now()}`,
        raw_name: "",
        ingredient_id: null,
        ingredient_name: null,
        total_quantity: null,
        unit: null,
        per_portion_quantity: null,
        confidence: "low",
        line_cost: null,
      },
    ]);
  };

  const removeLine = (index: number) => {
    setEditedLines(editedLines.filter((_, i) => i !== index));
  };

  const updateDishName = (name: string) => {
    if (!editedDraft) return;
    setEditedDraft({ ...editedDraft, dish_name: name });
  };

  const updatePortions = (portions: number | null) => {
    if (!editedDraft) return;
    setEditedDraft({
      ...editedDraft,
      portions,
    });
    setEditedLines(
      editedLines.map((l) => ({
        ...l,
        per_portion_quantity:
          l.total_quantity !== null && portions
            ? l.total_quantity / portions
            : null,
      }))
    );
  };

  const priceMap = useMemo(() => {
    const map = new Map<string, PriceInfo | null>();
    for (const ing of ingredients) map.set(ing.id, ing.price ?? null);
    return map;
  }, [ingredients]);
  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients]
  );
  const currencyOf = (draft: { currency: string | null } | null) =>
    draft?.currency || "USD";
  const costInputs = (lines: DraftLine[]): CostLineInput[] =>
    lines.map((l) => ({
      key: l.id,
      ingredient_id: l.ingredient_id,
      name:
        (l.ingredient_id ? ingredientById.get(l.ingredient_id)?.name : null) ??
        l.ingredient_name ??
        (l.raw_name || null),
      total_quantity: l.total_quantity,
      unit: l.unit,
    }));

  // The dish's selling price: the chosen menu dish, or the one typed for a new dish.
  const sellingPrice = (() => {
    if (selectedMenuItem === "new") {
      const typed = parseFloat(newSellingPrice);
      return Number.isFinite(typed) ? typed : null;
    }
    const price = menuItems.find(
      (m) => m.id === selectedMenuItem
    )?.selling_price;
    return typeof price === "number" ? price : null;
  })();
  // Recalculated on every change of quantity, unit, ingredient, price or portions.
  const liveCost: DraftCost | null = editedDraft
    ? computeDraftCost(
        costInputs(editedLines),
        priceMap,
        editedDraft.portions,
        sellingPrice
      )
    : null;

  const canConfirm =
    !!editedDraft?.portions &&
    Number.isInteger(editedDraft.portions) &&
    editedDraft.portions > 0 &&
    editedLines.length > 0 &&
    editedLines.every(
      (l) =>
        l.ingredient_id &&
        l.total_quantity !== null &&
        l.total_quantity > 0 &&
        l.unit
    );

  const selectClass =
    "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Recetas para revisar</CardTitle>
          <CardDescription>
            Recetas que envían tus cocineros por foto, voz o texto. Revísalas y
            confírmalas: pasan a Menú como borrador y no cuentan en los costos
            hasta que alguien las apruebe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-2">
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={selectClass}
            >
              <option value="">Todas las ubicaciones</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {drafts.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No hay recetas pendientes.
            </p>
          )}
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-lg border p-3 hover:bg-muted/50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{draft.dish_name}</h3>
                      <Badge
                        className={CONFIDENCE_COLORS[draft.confidence] || ""}
                      >
                        {CONFIDENCE_LABELS[draft.confidence] ||
                          draft.confidence}
                      </Badge>
                      {draft.status === "awaiting_portions" && (
                        <Badge variant="outline">Faltan porciones</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {draft.staff_name} • {draft.location_name} •{" "}
                      {new Date(draft.created_at).toLocaleDateString()}
                    </p>
                    <DraftListCost
                      draft={draft}
                      cost={computeDraftCost(
                        costInputs(draft.lines),
                        priceMap,
                        draft.portions,
                        null
                      )}
                      currency={currencyOf(draft)}
                      canManage={canManage}
                      ingredientById={ingredientById}
                      open={pricesOpenFor === draft.id}
                      onToggle={() =>
                        setPricesOpenFor(
                          pricesOpenFor === draft.id ? null : draft.id
                        )
                      }
                      onPriceSaved={() => void loadIngredients()}
                    />
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditor(draft)}
                      >
                        Revisar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReject(draft.id)}
                      >
                        Rechazar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {editedDraft && (
        <Dialog open={!!editedDraft} onOpenChange={closeEditor}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Revisar receta</DialogTitle>
              <DialogDescription>
                Edita ingredientes, cantidades y porciones antes de confirmar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nombre del platillo</Label>
                <Input
                  value={editedDraft.dish_name}
                  onChange={(e) => updateDishName(e.target.value)}
                />
              </div>
              <div>
                <Label>Porciones</Label>
                <Input
                  type="number"
                  min="1"
                  value={editedDraft.portions ?? ""}
                  onChange={(e) =>
                    updatePortions(
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                />
              </div>
              <div>
                <Label>Platillo del menú</Label>
                <Select
                  value={selectedMenuItem}
                  onValueChange={setSelectedMenuItem}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Crear uno nuevo o elegir uno existente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Crear platillo nuevo</SelectItem>
                    {menuItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedMenuItem === "new" && (
                <div>
                  <Label>Precio de venta</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newSellingPrice}
                    onChange={(e) => setNewSellingPrice(e.target.value)}
                  />
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Ingredientes</Label>
                  <Button size="sm" variant="outline" onClick={addLine}>
                    Agregar línea
                  </Button>
                </div>
                <div className="space-y-2">
                  {editedLines.map((line, idx) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center"
                    >
                      <IngredientCombobox
                        ingredients={ingredients}
                        value={line.ingredient_id}
                        placeholder={line.raw_name || "Elegir ingrediente"}
                        ariaLabel={`Ingrediente de la línea ${idx + 1}`}
                        onSelect={(ing) => updateLineIngredient(idx, ing)}
                        onCreate={(name) => createIngredient(idx, name)}
                      />
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="Cant."
                        value={line.total_quantity ?? ""}
                        onChange={(e) =>
                          updateLineQuantity(
                            idx,
                            e.target.value ? parseFloat(e.target.value) : null
                          )
                        }
                      />
                      <Input
                        placeholder="Unidad"
                        value={line.unit ?? ""}
                        onChange={(e) => updateLineUnit(idx, e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar la línea ${idx + 1}`}
                        onClick={() => removeLine(idx)}
                      >
                        ×
                      </Button>
                      <LineHints
                        line={line}
                        costLine={liveCost?.lines[idx] ?? null}
                        currency={currencyOf(editedDraft)}
                        suggestion={
                          !line.ingredient_id && line.raw_name
                            ? (suggestIngredient(line.raw_name, ingredients)
                                ?.ingredient ?? null)
                            : null
                        }
                        ingredient={
                          line.ingredient_id
                            ? (ingredientById.get(line.ingredient_id) ?? null)
                            : null
                        }
                        priceEditOpen={priceEditLine === line.id}
                        onAcceptSuggestion={(ing) =>
                          updateLineIngredient(idx, ing)
                        }
                        onTogglePriceEdit={() =>
                          setPriceEditLine(
                            priceEditLine === line.id ? null : line.id
                          )
                        }
                        onPriceSaved={() => {
                          setPriceEditLine(null);
                          void loadIngredients();
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {liveCost ? (
                <CostFooter
                  cost={liveCost}
                  currency={currencyOf(editedDraft)}
                  hasLines={editedLines.length > 0}
                  sellingPrice={sellingPrice}
                />
              ) : null}
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={closeEditor}>
                  Cancelar
                </Button>
                <Button onClick={handleConfirm} disabled={!canConfirm}>
                  Confirmar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Under a line: «¿Es X?», its price and cost, and «Editar precio». */
function LineHints({
  line,
  costLine,
  currency,
  suggestion,
  ingredient,
  priceEditOpen,
  onAcceptSuggestion,
  onTogglePriceEdit,
  onPriceSaved,
}: {
  line: DraftLine;
  costLine: DraftCost["lines"][number] | null;
  currency: string;
  suggestion: ComboIngredient | null;
  ingredient: Ingredient | null;
  priceEditOpen: boolean;
  onAcceptSuggestion: (ingredient: ComboIngredient) => void;
  onTogglePriceEdit: () => void;
  onPriceSaved: () => void;
}) {
  const money = (n: number) => formatMoneyEs(n, currency);
  const price = ingredient?.price ?? null;
  return (
    <div className="col-span-full -mt-1 space-y-1 text-[12px] text-[#6b7385]">
      {suggestion ? (
        <p>
          ¿Es <b>{suggestion.name}</b>?{" "}
          <button
            type="button"
            className="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
            onClick={() => onAcceptSuggestion(suggestion)}
          >
            Sí, usarlo
          </button>
        </p>
      ) : null}
      {ingredient ? (
        <p className="flex flex-wrap items-center gap-x-3">
          {price ? (
            <span>
              Precio: {money(price.unit_cost)}/{price.unit}
              {costLine?.line_cost !== null && costLine?.line_cost !== undefined
                ? ` · Costo de la línea: ${money(costLine.line_cost)}`
                : ""}
            </span>
          ) : (
            <span className="font-semibold text-[#a35a00]">Sin precio</span>
          )}
          <button
            type="button"
            className="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
            onClick={onTogglePriceEdit}
          >
            Editar precio
          </button>
        </p>
      ) : null}
      {ingredient && priceEditOpen ? (
        <InlinePriceEditor
          ingredient={{
            id: ingredient.id,
            name: ingredient.name,
            default_unit: ingredient.default_unit ?? null,
          }}
          initialPrice={price?.unit_cost ?? null}
          initialUnit={price?.unit ?? null}
          onSaved={onPriceSaved}
          onCancel={onTogglePriceEdit}
        />
      ) : null}
      {line.unit && !normalizeUnit(line.unit) ? (
        <p className="text-[#c03535]">
          Esa unidad no la reconozco (g, kg, ml, l, pza…).
        </p>
      ) : null}
    </div>
  );
}

/** Estimated cost per portion and margin; never a total that is not complete. */
function CostFooter({
  cost,
  currency,
  hasLines,
  sellingPrice,
}: {
  cost: DraftCost;
  currency: string;
  hasLines: boolean;
  sellingPrice: number | null;
}) {
  const money = (n: number) => formatMoneyEs(n, currency);
  if (!hasLines) return null;
  const hasPrice = sellingPrice !== null && sellingPrice > 0;
  return (
    <div
      className="space-y-0.5 rounded-md border border-[#eef0f4] bg-[#f6f8fe] px-3 py-2 text-sm"
      data-testid="cost-footer"
    >
      {cost.complete && cost.total !== null ? (
        <p className="font-semibold text-[#151c2c]">
          {cost.per_portion !== null
            ? `Costo estimado: ${money(cost.per_portion)} por porción`
            : `Costo estimado: ${money(cost.total)} en total · indica las porciones`}
        </p>
      ) : (
        <p className="font-semibold text-[#a35a00]">
          Costo parcial · faltan precios de {cost.missing.join(", ")}
        </p>
      )}
      {cost.margin_pct !== null ? (
        <p className="text-[#26314a]">
          Margen estimado: {Math.round(cost.margin_pct * 10) / 10}%
        </p>
      ) : hasPrice ? (
        <p className="text-[#6b7385]">
          Margen estimado: falta el costo completo
        </p>
      ) : (
        <p className="text-[#6b7385]">Sin precio de venta</p>
      )}
      <p className="text-[12px] text-[#8a92a3]">
        Es solo un estimado: la receta no cuenta en costos hasta que se aprueba.
      </p>
    </div>
  );
}

/** On the Cocina card: live cost (partial vs complete) and «Faltan precios: N». */
function DraftListCost({
  draft,
  cost,
  currency,
  canManage,
  ingredientById,
  open,
  onToggle,
  onPriceSaved,
}: {
  draft: Draft;
  cost: DraftCost;
  currency: string;
  canManage: boolean;
  ingredientById: Map<string, Ingredient>;
  open: boolean;
  onToggle: () => void;
  onPriceSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const money = (n: number) => formatMoneyEs(n, currency);
  if (draft.lines.length === 0) return null;
  // The distinct ingredients (chosen) that still have no price.
  const unpriced = [
    ...new Map(
      cost.lines
        .map((c, i) => ({ c, line: draft.lines[i] }))
        .filter(({ c, line }) => c.reason === "no_price" && line.ingredient_id)
        .map(({ line }) => [line.ingredient_id as string, line.ingredient_id])
    ).keys(),
  ]
    .map((id) => ingredientById.get(id))
    .filter((ing): ing is Ingredient => Boolean(ing));
  return (
    <div className="space-y-1 text-sm">
      {cost.complete && cost.per_portion !== null && draft.portions ? (
        <p>
          {draft.portions} {draft.portions > 1 ? "porciones" : "porción"} •
          Costo: {money(cost.per_portion)} por porción
        </p>
      ) : cost.missing.length > 0 ? (
        <p className="text-[#a35a00]">
          Costo parcial · faltan precios de {cost.missing.join(", ")}
        </p>
      ) : null}
      {cost.unpriced_count > 0 ? (
        <p className="flex items-center gap-2">
          <Badge variant="outline">Faltan precios: {cost.unpriced_count}</Badge>
          {canManage && unpriced.length > 0 ? (
            <button
              type="button"
              className="text-[12px] font-semibold text-[#1B40C8] underline"
              onClick={onToggle}
            >
              {open ? "Ocultar" : "Poner precios"}
            </button>
          ) : null}
        </p>
      ) : null}
      {open && canManage
        ? unpriced.map((ing) => (
            <div key={ing.id} className="text-[12px]">
              <span className="font-medium">{ing.name}</span>{" "}
              <button
                type="button"
                className="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
                onClick={() => setEditing(editing === ing.id ? null : ing.id)}
              >
                Editar precio
              </button>
              {editing === ing.id ? (
                <InlinePriceEditor
                  ingredient={{
                    id: ing.id,
                    name: ing.name,
                    default_unit: ing.default_unit ?? null,
                  }}
                  onSaved={() => {
                    setEditing(null);
                    onPriceSaved();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </div>
          ))
        : null}
    </div>
  );
}
