"use client";

// components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx
//
// Manager review UI for recipe drafts: list drafts, edit ingredients/portions/units,
// add/remove lines, pick menu item, confirm or reject. English UI (cook-facing bot
// stays Spanish). Confirm disabled until all lines resolved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PricePopover } from "./PricePopover";
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
import { KITCHEN_UNITS, mapKitchenUnit } from "@/lib/restaurant/kitchen-units";
import { sentenceCase } from "@/lib/restaurant/sentence-case";
import {
  isPreparationName,
  stripPreparationMarker,
  withPreparationMarker,
} from "@/lib/restaurant/recipe-upload/marker";

interface DraftLine {
  id: string;
  raw_name: string;
  ingredient_id: string | null;
  ingredient_name: string | null;
  total_quantity: number | null;
  unit: string | null;
  /** Client only: what the cook said when it is not one of the dropdown's units. */
  raw_unit?: string | null;
  per_portion_quantity: number | null;
  confidence: string;
  line_cost: number | null;
}

interface Draft {
  id: string;
  dish_name: string;
  menu_item_id?: string | null;
  portions: number | null;
  status: string;
  confidence: string;
  per_portion_cost: number | null;
  currency: string | null;
  created_at: string;
  staff_name: string;
  location_name: string;
  /** An approved dish already has this name (computed by the list API). */
  approved_exists?: boolean;
  /** A sub-recipe from a file: the name carries a marker the UI never shows. */
  is_preparation?: boolean;
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
  medium: "bg-gray-100 text-gray-700",
  low: "bg-red-100 text-red-800",
};

/** numeric columns can arrive as strings ("240.000"): always a number or null. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    portions: toNumber(draft.portions),
    per_portion_cost: toNumber(draft.per_portion_cost),
    lines: (draft.lines ?? []).map((l) => ({
      ...l,
      total_quantity: toNumber(l.total_quantity),
      per_portion_quantity: toNumber(l.per_portion_quantity),
      line_cost: toNumber(l.line_cost),
    })),
  };
}

/**
 * Each line's unit as one of the dropdown's. What cannot be mapped is left
 * empty in the dropdown but the cook's word is kept (raw_unit) so it is never
 * lost or overwritten with nothing.
 */
function withDropdownUnits(lines: DraftLine[]): DraftLine[] {
  return (JSON.parse(JSON.stringify(lines)) as DraftLine[]).map((l) => {
    const original = typeof l.unit === "string" ? l.unit.trim() : "";
    const mapped = mapKitchenUnit(l.unit);
    return {
      ...l,
      unit: mapped,
      raw_unit: mapped ? null : original || null,
    };
  });
}

/** The copy the editor works on: the name never shows the preparation marker. */
function editableCopy(draft: Draft): Draft {
  const copy = JSON.parse(JSON.stringify(draft)) as Draft;
  copy.is_preparation =
    copy.is_preparation === true || isPreparationName(copy.dish_name);
  copy.dish_name = stripPreparationMarker(copy.dish_name);
  return copy;
}

/** What goes to the server: a preparation keeps its marker on the name. */
function nameForSave(draft: Draft, isPreparation: boolean): string {
  return isPreparation
    ? withPreparationMarker(draft.dish_name)
    : draft.dish_name;
}

/** What the editor shows, as one string: used to know if there are unsaved changes. */
function editorSnapshot(
  draft: Draft | null,
  lines: DraftLine[],
  menuItemId: string,
  price: string
): string {
  if (!draft) return "";
  return JSON.stringify([
    draft.dish_name,
    draft.portions,
    menuItemId,
    price.trim(),
    lines.map((l) => [
      l.id,
      l.raw_name,
      l.ingredient_id,
      l.total_quantity,
      l.unit,
      l.raw_unit ?? null,
    ]),
  ]);
}

const sellingPriceKey = (draftId: string) => `milton:draft-price:${draftId}`;
function readSavedPrice(draftId: string): string {
  try {
    return window.localStorage.getItem(sellingPriceKey(draftId)) ?? "";
  } catch {
    return "";
  }
}
function writeSavedPrice(draftId: string, value: string) {
  try {
    if (value.trim())
      window.localStorage.setItem(sellingPriceKey(draftId), value);
    else window.localStorage.removeItem(sellingPriceKey(draftId));
  } catch {
    // private window / blocked storage: the price just is not remembered
  }
}

export function KitchenRecipeDraftsCard({
  canManage,
  locations,
  focusDraftId,
  reloadSignal = 0,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
  focusDraftId?: string | null;
  /** Changes when something outside (a file upload) added drafts: reload. */
  reloadSignal?: number;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  // The active list is known (an empty list is a real answer, not "loading").
  const [ingredientsLoaded, setIngredientsLoaded] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [editedDraft, setEditedDraft] = useState<Draft | null>(null);
  const [editedLines, setEditedLines] = useState<DraftLine[]>([]);
  const [selectedMenuItem, setSelectedMenuItem] = useState<string>("");
  const [newSellingPrice, setNewSellingPrice] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  // Which draft has its «Poner precios» list open (Cocina card).
  const [pricesOpenFor, setPricesOpenFor] = useState<string | null>(null);
  // What the editor looked like when it was opened / last saved, to know if
  // there are unsaved changes; and the ingredient the bot picked per line, so
  // only the reviewer's own picks are taught after Confirmar.
  const [baseline, setBaseline] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalMessage, setModalMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const botPicks = useRef(new Map<string, string | null>());

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
      const next = ((data.drafts ?? []) as Draft[]).map(normalizeDraft);
      setDrafts(next);
      if (focusDraftId) {
        const hit = next.find((d) => d.id === focusDraftId);
        if (hit) {
          const lines = withDropdownUnits(hit.lines);
          const menuId = hit.menu_item_id ?? "";
          const price = readSavedPrice(hit.id);
          setSelectedDraft(hit);
          setEditedDraft(editableCopy(hit));
          setEditedLines(lines);
          setSelectedMenuItem(menuId);
          setNewSellingPrice(price);
          setBaseline(editorSnapshot(hit, lines, menuId, price));
          botPicks.current = new Map(
            hit.lines.map((l) => [l.id, l.ingredient_id])
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, reloadKey, focusDraftId, reloadSignal]);

  const loadIngredients = useCallback(async () => {
    const res = await fetch("/api/restaurant/kitchen/ingredients");
    if (res.ok) {
      const data = await res.json();
      setIngredients(data.ingredients ?? []);
      setIngredientsLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/restaurant/kitchen/ingredients");
      if (cancelled || !res.ok) return;
      const data = await res.json();
      if (!cancelled) {
        setIngredients(data.ingredients ?? []);
        setIngredientsLoaded(true);
      }
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
    const lines = withDropdownUnits(draft.lines);
    const menuId = draft.menu_item_id ?? "";
    const price = readSavedPrice(draft.id);
    setSelectedDraft(draft);
    setEditedDraft(editableCopy(draft));
    setEditedLines(lines);
    setSelectedMenuItem(menuId);
    setNewSellingPrice(price);
    setBaseline(editorSnapshot(draft, lines, menuId, price));
    setConfirmClose(false);
    setModalMessage(null);
    botPicks.current = new Map(draft.lines.map((l) => [l.id, l.ingredient_id]));
  };

  const closeEditor = () => {
    setSelectedDraft(null);
    setEditedDraft(null);
    setEditedLines([]);
    setSelectedMenuItem("");
    setNewSellingPrice("");
    setBaseline("");
    setConfirmClose(false);
    setModalMessage(null);
  };

  /** ×, Esc, outside click and «Cancelar»: ask first when there is unsaved work. */
  const requestClose = () => {
    if (
      editedDraft &&
      editorSnapshot(
        editedDraft,
        editedLines,
        selectedMenuItem,
        newSellingPrice
      ) !== baseline
    ) {
      setConfirmClose(true);
      return;
    }
    closeEditor();
  };

  /**
   * «Guardar borrador»: stores exactly what is on screen (unmatched lines,
   * missing quantities, units or portions included; no prices) through the
   * draft PATCH. The cook's own unit word is kept when it is not in the
   * dropdown, never replaced by nothing.
   */
  const handleSaveDraft = async (): Promise<boolean> => {
    if (!editedDraft) return false;
    setSaving(true);
    setModalMessage(null);
    try {
      const menuItemId =
        selectedMenuItem && selectedMenuItem !== "new"
          ? selectedMenuItem
          : null;
      const res = await fetch(
        `/api/restaurant/kitchen/recipe-drafts/${editedDraft.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dish_name: nameForSave(editedDraft, editingPreparation),
            portions: editedDraft.portions,
            menu_item_id: menuItemId,
            lines: cleanLines.map((l) => ({
              id: l.id,
              raw_name: l.raw_name || l.ingredient_name || "",
              ingredient_id: l.ingredient_id,
              total_quantity:
                l.total_quantity && l.total_quantity > 0
                  ? l.total_quantity
                  : null,
              unit: l.unit ?? l.raw_unit ?? null,
            })),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lines?: DraftLine[];
      };
      if (!res.ok) {
        setModalMessage({
          kind: "error",
          text: data.error ?? "No se pudo guardar el borrador.",
        });
        return false;
      }
      const stored = Array.isArray(data.lines) ? data.lines : [];
      const lines: DraftLine[] =
        stored.length === cleanLines.length
          ? cleanLines.map((l, i) => ({
              ...l,
              id: stored[i].id,
              total_quantity: toNumber(stored[i].total_quantity),
              per_portion_quantity: toNumber(stored[i].per_portion_quantity),
            }))
          : cleanLines;
      const saved: Draft = {
        ...editedDraft,
        menu_item_id: menuItemId,
        status:
          editedDraft.status === "awaiting_portions" && editedDraft.portions
            ? "draft"
            : editedDraft.status,
        lines,
      };
      writeSavedPrice(saved.id, newSellingPrice);
      setSelectedDraft(saved);
      setEditedDraft(saved);
      setEditedLines(lines);
      setDrafts((all) => all.map((d) => (d.id === saved.id ? saved : d)));
      setBaseline(
        editorSnapshot(saved, lines, selectedMenuItem, newSellingPrice)
      );
      setModalMessage({ kind: "ok", text: "Borrador guardado." });
      return true;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Confirmar sends everything in the confirm body and nothing else: the
   * draft is not rewritten first, so a refused confirm leaves it exactly as
   * it was.
   */
  const handleConfirm = async () => {
    if (!editedDraft) return;

    const menuItemId =
      selectedMenuItem === "new" ? undefined : selectedMenuItem || undefined;
    const typedPrice = parseFloat(newSellingPrice);
    const sellingPrice =
      !menuItemId && Number.isFinite(typedPrice) && typedPrice > 0
        ? typedPrice
        : undefined;

    setModalMessage(null);
    const res = await fetch(
      `/api/restaurant/kitchen/recipe-drafts/${editedDraft.id}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: nameForSave(editedDraft, editingPreparation),
          portions: editedDraft.portions,
          menu_item_id: menuItemId,
          selling_price: sellingPrice,
          lines: cleanLines.map((l) => ({
            id: l.id,
            ingredient_id: l.ingredient_id,
            total_quantity: l.total_quantity,
            unit: l.unit,
          })),
        }),
      }
    );
    if (res.ok) {
      await teachNames(cleanLines);
      writeSavedPrice(editedDraft.id, "");
      closeEditor();
      setReloadKey((k) => k + 1);
    } else {
      const data = await res.json().catch(() => ({}));
      setModalMessage({
        kind: "error",
        text: data.error ?? "No se pudo confirmar.",
      });
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

  /**
   * After a successful Confirmar: remember, for each line whose ingredient the
   * reviewer chose (the bot matched none, or another one), that the cook's
   * words mean it. The server only ever INSERTS (it never repoints a name that
   * already has an alias), and ignores names that are an ingredient's own name.
   */
  const teachNames = async (lines: DraftLine[]) => {
    const botPicked = botPicks.current;
    const taught = lines.filter(
      (l) =>
        l.ingredient_id &&
        l.raw_name.trim() &&
        botPicked.get(l.id) !== l.ingredient_id
    );
    await Promise.allSettled(
      taught.map((l) =>
        fetch("/api/restaurant/kitchen/ingredient-aliases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            raw_name: l.raw_name.trim(),
            ingredient_id: l.ingredient_id,
            draft_id: editedDraft?.id,
          }),
        })
      )
    );
  };

  const updateLineIngredient = (index: number, ing: ComboIngredient) => {
    const newLines = [...editedLines];
    newLines[index] = {
      ...newLines[index],
      ingredient_id: ing.id,
      ingredient_name: ing.name,
    };
    setEditedLines(newLines);
    // Nothing is taught here: a pick in a draft that is cancelled or rejected
    // teaches nothing. The names are saved after a successful Confirmar.
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
        unit: lineUnit || undefined,
        draft_id: editedDraft?.id,
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
    newLines[index] = { ...newLines[index], unit, raw_unit: null };
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
  // A line whose ingredient is not in the ACTIVE list (merged away or
  // archived) counts as not picked: the person has to choose again.
  const isStale = (l: DraftLine) =>
    ingredientsLoaded &&
    Boolean(l.ingredient_id) &&
    !ingredientById.has(l.ingredient_id as string);
  const cleanLines: DraftLine[] = editedLines.map((l) =>
    isStale(l) ? { ...l, ingredient_id: null, ingredient_name: null } : l
  );
  const costInputs = (lines: DraftLine[]): CostLineInput[] =>
    lines.map((l) => ({
      key: l.id,
      ingredient_id: isStale(l) ? null : l.ingredient_id,
      name:
        (l.ingredient_id ? ingredientById.get(l.ingredient_id)?.name : null) ??
        l.ingredient_name ??
        (l.raw_name || null),
      total_quantity: l.total_quantity,
      unit: l.unit,
    }));

  // The dish's selling price: the chosen menu dish's, or the one typed for a
  // new dish. Above 0 only: a price of 0 means «Sin precio».
  const selectedItem = menuItems.find((m) => m.id === selectedMenuItem) ?? null;
  const priceEditable = !selectedItem;
  const sellingPrice = (() => {
    if (selectedItem) {
      const price = selectedItem.selling_price;
      return typeof price === "number" && price > 0 ? price : null;
    }
    const typed = parseFloat(newSellingPrice);
    return Number.isFinite(typed) && typed > 0 ? typed : null;
  })();
  // Recalculated on every change of quantity, unit, ingredient, price or portions.
  const liveCost: DraftCost | null = editedDraft
    ? computeDraftCost(
        costInputs(cleanLines),
        priceMap,
        editedDraft.portions,
        sellingPrice
      )
    : null;

  const editingPreparation =
    !!selectedDraft &&
    (selectedDraft.is_preparation === true ||
      isPreparationName(selectedDraft.dish_name));
  const editingApprovedExists = selectedDraft?.approved_exists === true;

  const canConfirm =
    !editingPreparation &&
    !!editedDraft?.portions &&
    Number.isInteger(editedDraft.portions) &&
    editedDraft.portions > 0 &&
    cleanLines.length > 0 &&
    cleanLines.every(
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
            Recetas que envían tus cocineros por Telegram o que subes desde un
            archivo. Revísalas y confírmalas: pasan a Menú como borrador y no
            cuentan en los costos hasta que alguien las apruebe.
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
                      <h3 className="font-medium">
                        {stripPreparationMarker(draft.dish_name)}
                      </h3>
                      {draft.is_preparation ||
                      isPreparationName(draft.dish_name) ? (
                        <Badge variant="outline">Preparación</Badge>
                      ) : null}
                      {draft.approved_exists ? (
                        <Badge variant="outline">
                          Ya existe una receta aprobada
                        </Badge>
                      ) : null}
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
        <Dialog
          open={!!editedDraft}
          onOpenChange={(open) => {
            if (!open) requestClose();
          }}
        >
          <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px] max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
            <DialogHeader className="px-5 pb-2 pt-5">
              <DialogTitle>Revisar receta</DialogTitle>
              <DialogDescription>
                Revisa los ingredientes y confirma.
              </DialogDescription>
            </DialogHeader>

            {editingPreparation ? (
              <p
                role="note"
                className="mx-5 mb-2 rounded-md border border-[#dfe3ea] bg-[#f6f8fe] px-3 py-2 text-sm text-[#151c2c]"
              >
                Esta es una preparación (sub-receta). Por ahora créala en Menú ›
                Preparaciones; aquí se confirmaría como plato.
              </p>
            ) : null}
            {editingApprovedExists ? (
              <p
                role="note"
                className="mx-5 mb-2 rounded-md border border-[#dfe3ea] bg-[#f6f8fe] px-3 py-2 text-sm text-[#151c2c]"
              >
                Ya hay una receta aprobada con este nombre. Confirmar NO la
                cambia: crea una versión nueva para revisar.
              </p>
            ) : null}

            {/* Top fields: one row on desktop. */}
            <div className="grid grid-cols-1 gap-3 px-5 pb-3 md:grid-cols-[2fr_1fr_2fr_1fr]">
              <div>
                <Label>Nombre del plato</Label>
                <Input
                  aria-label="Nombre del plato"
                  value={editedDraft.dish_name}
                  onChange={(e) => updateDishName(e.target.value)}
                />
              </div>
              <div>
                <Label>Porciones</Label>
                <Input
                  aria-label="Porciones"
                  type="number"
                  min="1"
                  value={editedDraft.portions ?? ""}
                  onChange={(e) =>
                    updatePortions(
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                />
                {editedDraft.portions === null &&
                selectedDraft?.status === "awaiting_portions" ? (
                  <p className="mt-1 text-[12px] text-[#6b7385]">
                    El cocinero no dijo para cuántas porciones. Escríbelo aquí.
                  </p>
                ) : null}
              </div>
              <div>
                <Label>Plato del menú</Label>
                <Select
                  value={selectedMenuItem}
                  onValueChange={setSelectedMenuItem}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Crear uno nuevo o elegir uno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Crear plato nuevo</SelectItem>
                    {menuItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Precio de venta</Label>
                <Input
                  aria-label="Precio de venta"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Sin precio"
                  className="placeholder:text-[#8a92a3]"
                  disabled={!priceEditable}
                  value={
                    priceEditable
                      ? newSellingPrice
                      : sellingPrice !== null
                        ? String(sellingPrice)
                        : ""
                  }
                  onChange={(e) => setNewSellingPrice(e.target.value)}
                />
              </div>
            </div>

            {/* The ingredient table: only this part scrolls. */}
            <div className="flex min-h-0 flex-1 flex-col border-t border-[#eef0f4]">
              <div className="flex items-center justify-between px-5 py-2">
                <Label>Ingredientes</Label>
                <Button size="sm" variant="outline" onClick={addLine}>
                  Agregar línea
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-[12px] text-[#6b7385]">
                      <th className="w-[44%] pb-1 font-semibold">
                        Ingrediente
                      </th>
                      <th className="w-[14%] pb-1 font-semibold">Cantidad</th>
                      <th className="w-[16%] pb-1 font-semibold">Unidad</th>
                      <th className="w-[20%] pb-1 text-right font-semibold">
                        Costo
                      </th>
                      <th className="w-[6%] pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {cleanLines.map((line, idx) => {
                      const ingredient = line.ingredient_id
                        ? (ingredientById.get(line.ingredient_id) ?? null)
                        : null;
                      const suggestion =
                        !line.ingredient_id && line.raw_name
                          ? (suggestIngredient(line.raw_name, ingredients)
                              ?.ingredient ?? null)
                          : null;
                      return (
                        <tr key={line.id} className="align-top">
                          <td className="py-1 pr-2">
                            <IngredientCombobox
                              ingredients={ingredients}
                              value={line.ingredient_id}
                              rawName={line.raw_name}
                              placeholder="Elegir ingrediente"
                              ariaLabel={`Ingrediente de la línea ${idx + 1}`}
                              onSelect={(ing) => updateLineIngredient(idx, ing)}
                              onCreate={(name) => createIngredient(idx, name)}
                            />
                            {suggestion ? (
                              <p className="mt-0.5 text-[12px] text-[#6b7385]">
                                ¿Es <b>{sentenceCase(suggestion.name)}</b>?{" "}
                                <button
                                  type="button"
                                  className="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
                                  onClick={() =>
                                    updateLineIngredient(idx, suggestion)
                                  }
                                >
                                  Sí, usarlo
                                </button>
                              </p>
                            ) : null}
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              type="number"
                              step="0.001"
                              aria-label={`Cantidad de la línea ${idx + 1}`}
                              placeholder="Cant."
                              value={line.total_quantity ?? ""}
                              onChange={(e) =>
                                updateLineQuantity(
                                  idx,
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null
                                )
                              }
                            />
                            {line.total_quantity === null ||
                            line.total_quantity <= 0 ? (
                              <p className="mt-0.5 text-[12px] text-[#6b7280]">
                                falta cantidad
                              </p>
                            ) : null}
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              aria-label={`Unidad de la línea ${idx + 1}`}
                              className="h-9 w-full rounded-md border border-[#e3e7ee] bg-white px-2 text-sm focus:border-[#1B40C8] focus:outline-none focus:ring-2 focus:ring-[#c6d3f5]"
                              value={line.unit ?? ""}
                              onChange={(e) =>
                                updateLineUnit(idx, e.target.value)
                              }
                            >
                              <option value="">
                                {line.raw_unit ? `${line.raw_unit}?` : "Unidad"}
                              </option>
                              {KITCHEN_UNITS.map((u) => (
                                <option key={u.value} value={u.value}>
                                  {u.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 pr-2 text-right">
                            <LineCost
                              ingredient={ingredient}
                              costLine={liveCost?.lines[idx] ?? null}
                              currency={currencyOf(editedDraft)}
                              quantity={line.total_quantity}
                              unit={line.unit}
                              draftId={editedDraft.id}
                              onSaved={() => void loadIngredients()}
                            />
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Quitar la línea ${idx + 1}`}
                              onClick={() => removeLine(idx)}
                            >
                              ×
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer: always visible. */}
            <div className="flex flex-wrap items-center gap-3 border-t border-[#eef0f4] bg-white px-5 py-3">
              {liveCost ? (
                <CostFooter
                  cost={liveCost}
                  currency={currencyOf(editedDraft)}
                  hasLines={cleanLines.length > 0}
                  sellingPrice={sellingPrice}
                />
              ) : null}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {modalMessage ? (
                  <p
                    role={modalMessage.kind === "error" ? "alert" : "status"}
                    className={
                      modalMessage.kind === "error"
                        ? "text-sm text-red-600"
                        : "text-sm text-[#6b7385]"
                    }
                  >
                    {modalMessage.text}
                  </p>
                ) : null}
                <Button variant="outline" onClick={requestClose}>
                  Cancelar
                </Button>
                <Button
                  variant="outline"
                  className="border-[#1B40C8] text-[#1B40C8] hover:bg-[#f6f8fe]"
                  disabled={saving}
                  onClick={() => void handleSaveDraft()}
                >
                  Guardar borrador
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!canConfirm || saving}
                >
                  Confirmar
                </Button>
              </div>
            </div>
            {confirmClose ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/85 p-4">
                <div
                  role="alertdialog"
                  aria-label="¿Guardar cambios?"
                  className="w-full max-w-sm space-y-3 rounded-lg border border-[#e3e7ee] bg-white p-4 shadow-lg"
                >
                  <p className="font-semibold text-[#151c2c]">
                    ¿Guardar cambios?
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      className="border-[#1B40C8] text-[#1B40C8] hover:bg-[#f6f8fe]"
                      onClick={() => {
                        setConfirmClose(false);
                        closeEditor();
                      }}
                    >
                      Salir sin guardar
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={async () => {
                        const ok = await handleSaveDraft();
                        setConfirmClose(false);
                        if (ok) closeEditor();
                      }}
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** The cost cell of a row: the line cost, a gray «Sin precio» link, or a dash. Both open the price popover. */
function LineCost({
  ingredient,
  costLine,
  currency,
  quantity,
  unit,
  draftId,
  onSaved,
}: {
  ingredient: Ingredient | null;
  costLine: DraftCost["lines"][number] | null;
  currency: string;
  quantity: number | null;
  unit: string | null;
  draftId: string;
  onSaved: () => void;
}) {
  if (!ingredient) return <span className="text-[#aeb4c2]">—</span>;
  const price = ingredient.price ?? null;
  const lineCost = costLine?.line_cost ?? null;
  return (
    <PricePopover
      ingredient={{
        id: ingredient.id,
        name: ingredient.name,
        default_unit: ingredient.default_unit ?? null,
      }}
      initialPrice={price?.unit_cost ?? null}
      initialUnit={price?.unit ?? null}
      draftId={draftId}
      triggerLabel={`Precio de ${sentenceCase(ingredient.name)}`}
      triggerClassName={
        price && lineCost !== null
          ? "rounded px-1 font-semibold text-[#151c2c] hover:bg-[#f6f8fe] hover:underline"
          : "rounded px-1 text-[12px] text-[#6b7385] underline hover:bg-[#f6f8fe]"
      }
      onSaved={onSaved}
    >
      {!price
        ? "Sin precio"
        : lineCost !== null
          ? formatMoneyEs(lineCost, currency)
          : !quantity || quantity <= 0
            ? "Falta cantidad"
            : !unit
              ? "Falta unidad"
              : "—"}
    </PricePopover>
  );
}

/** One line: «Costo por porción: $X · Margen: Y%», or the partial count; (i) = it is an estimate. */
export function CostFooter({
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
  if (!hasLines) return null;
  const money = (n: number) => formatMoneyEs(n, currency);
  const parts: string[] = [];
  if (cost.complete && cost.total !== null) {
    parts.push(
      cost.per_portion !== null
        ? `Costo por porción: ${money(cost.per_portion)}`
        : "Indica las porciones para ver el costo por porción"
    );
  } else {
    const missing = cost.lines.filter((l) => l.line_cost === null).length;
    parts.push(
      `Costo parcial · ${missing === 1 ? "falta 1 precio" : `faltan ${missing} precios`}`
    );
  }
  if (cost.margin_pct !== null) {
    parts.push(`Margen: ${Math.round(cost.margin_pct * 10) / 10}%`);
  } else if (sellingPrice === null || sellingPrice <= 0) {
    parts.push("Agrega un precio de venta para ver el margen");
  }
  return (
    <p className="text-sm text-[#26314a]" data-testid="cost-footer">
      <span className={cost.complete ? "font-semibold" : "text-[#6b7385]"}>
        {parts.join(" · ")}
      </span>{" "}
      <span
        role="img"
        tabIndex={0}
        aria-label="Es un estimado; no cuenta en costos hasta que se apruebe."
        title="Es un estimado; no cuenta en costos hasta que se apruebe."
        className="cursor-help rounded-full border border-[#aeb4c2] px-1 text-[11px] text-[#8a92a3]"
      >
        i
      </span>
    </p>
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
        <p className="text-[#6b7385]">
          Costo parcial · faltan precios de{" "}
          {cost.missing.map(sentenceCase).join(", ")}
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
            <div key={ing.id} className="flex items-center gap-2 text-[12px]">
              <span className="font-medium">{sentenceCase(ing.name)}</span>
              <PricePopover
                ingredient={{
                  id: ing.id,
                  name: ing.name,
                  default_unit: ing.default_unit ?? null,
                }}
                draftId={draft.id}
                triggerLabel={`Poner precio a ${sentenceCase(ing.name)}`}
                triggerClassName="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
                onSaved={onPriceSaved}
              >
                Poner precio
              </PricePopover>
            </div>
          ))
        : null}
    </div>
  );
}
