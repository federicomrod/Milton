"use client";

// components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx
//
// Manager review UI for recipe drafts: list drafts, edit ingredients/portions/units,
// add/remove lines, pick menu item, confirm or reject. English UI (cook-facing bot
// stays Spanish). Confirm disabled until all lines resolved.

import { useEffect, useState } from "react";
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
}

interface MenuItem {
  id: string;
  name: string;
  selling_price: number | null;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-red-100 text-red-800",
};

export function KitchenRecipeDraftsCard({
  canManage,
  locations,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
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
        setError("Could not load drafts.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setError(null);
      setDrafts(data.drafts ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/restaurant/kitchen/ingredients");
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        setIngredients(data.ingredients ?? []);
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
      setError(data.error ?? "Could not save draft edits.");
      return;
    }

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
          lines: editedLines.map((l) => ({
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
      setError(data.error ?? "Confirm failed.");
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

  const updateLineIngredient = (index: number, ingredientId: string) => {
    const ing = ingredients.find((i) => i.id === ingredientId);
    const newLines = [...editedLines];
    newLines[index] = {
      ...newLines[index],
      ingredient_id: ingredientId,
      ingredient_name: ing?.name ?? null,
    };
    setEditedLines(newLines);
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
          <CardTitle>Recipes to Review</CardTitle>
          <CardDescription>
            Recipes sent by cooks via photo, voice, or text. Review and confirm
            to add to menu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-2">
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={selectClass}
            >
              <option value="">All locations</option>
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
              No pending recipe drafts.
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
                        <Badge variant="outline">Awaiting portions</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {draft.staff_name} • {draft.location_name} •{" "}
                      {new Date(draft.created_at).toLocaleDateString()}
                    </p>
                    {draft.portions && draft.per_portion_cost !== null && (
                      <p className="text-sm">
                        {draft.portions} portion{draft.portions > 1 ? "s" : ""}{" "}
                        • {draft.currency} {draft.per_portion_cost.toFixed(2)}{" "}
                        per portion
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditor(draft)}
                      >
                        Review
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReject(draft.id)}
                      >
                        Reject
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
              <DialogTitle>Review Recipe</DialogTitle>
              <DialogDescription>
                Edit ingredients, quantities, and portions before confirming.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Dish Name</Label>
                <Input
                  value={editedDraft.dish_name}
                  onChange={(e) => updateDishName(e.target.value)}
                />
              </div>
              <div>
                <Label>Portions</Label>
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
                <Label>Menu Item</Label>
                <Select
                  value={selectedMenuItem}
                  onValueChange={setSelectedMenuItem}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Create new or pick existing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new menu item</SelectItem>
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
                  <Label>Selling Price</Label>
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
                  <Label>Ingredients</Label>
                  <Button size="sm" variant="outline" onClick={addLine}>
                    Add Line
                  </Button>
                </div>
                <div className="space-y-2">
                  {editedLines.map((line, idx) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center"
                    >
                      <Select
                        value={line.ingredient_id ?? ""}
                        onValueChange={(val) => updateLineIngredient(idx, val)}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={line.raw_name || "Select ingredient"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.map((ing) => (
                            <SelectItem key={ing.id} value={ing.id}>
                              {ing.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="Qty"
                        value={line.total_quantity ?? ""}
                        onChange={(e) =>
                          updateLineQuantity(
                            idx,
                            e.target.value ? parseFloat(e.target.value) : null
                          )
                        }
                      />
                      <Input
                        placeholder="Unit"
                        value={line.unit ?? ""}
                        onChange={(e) => updateLineUnit(idx, e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(idx)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={!canConfirm}>
                  Confirm
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
