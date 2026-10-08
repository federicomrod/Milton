"use client";

// components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx
//
// Manager review UI for recipe drafts: list drafts, edit ingredients/portions,
// confirm or reject. Only drafts and awaiting_portions show; confirmed and
// rejected are hidden. Confirm writes to recipes / menu_recipe_inputs.

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
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [editedDraft, setEditedDraft] = useState<Draft | null>(null);
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

  const openEditor = (draft: Draft) => {
    setSelectedDraft(draft);
    setEditedDraft(JSON.parse(JSON.stringify(draft)));
  };

  const closeEditor = () => {
    setSelectedDraft(null);
    setEditedDraft(null);
  };

  const handleConfirm = async () => {
    if (!editedDraft) return;
    const res = await fetch(
      `/api/restaurant/kitchen/recipe-drafts/${editedDraft.id}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: editedDraft.dish_name,
          portions: editedDraft.portions,
          lines: editedDraft.lines,
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

  const updateLineIngredient = (lineId: string, ingredientId: string) => {
    if (!editedDraft) return;
    const ing = ingredients.find((i) => i.id === ingredientId);
    setEditedDraft({
      ...editedDraft,
      lines: editedDraft.lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              ingredient_id: ingredientId,
              ingredient_name: ing?.name ?? null,
            }
          : l
      ),
    });
  };

  const updateLineQuantity = (lineId: string, quantity: number | null) => {
    if (!editedDraft) return;
    setEditedDraft({
      ...editedDraft,
      lines: editedDraft.lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              total_quantity: quantity,
              per_portion_quantity:
                quantity !== null && editedDraft.portions
                  ? quantity / editedDraft.portions
                  : null,
            }
          : l
      ),
    });
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
      lines: editedDraft.lines.map((l) => ({
        ...l,
        per_portion_quantity:
          l.total_quantity !== null && portions
            ? l.total_quantity / portions
            : null,
      })),
    });
  };

  const selectClass =
    "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Recetas por Revisar</CardTitle>
          <CardDescription>
            Recetas enviadas por cocineros con foto, voz o texto. Revisa y
            confirma.
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
                        <Badge variant="outline">Esperando porciones</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {draft.staff_name} • {draft.location_name} •{" "}
                      {new Date(draft.created_at).toLocaleDateString("es-MX")}
                    </p>
                    {draft.portions && draft.per_portion_cost !== null && (
                      <p className="text-sm">
                        {draft.portions} porción{draft.portions > 1 ? "es" : ""}{" "}
                        • {draft.currency} {draft.per_portion_cost.toFixed(2)}{" "}
                        por porción
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
              <DialogTitle>Revisar Receta</DialogTitle>
              <DialogDescription>
                Edita ingredientes, cantidades y porciones antes de confirmar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Platillo</Label>
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
                <Label>Ingredientes</Label>
                <div className="space-y-2 mt-2">
                  {editedDraft.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-3 gap-2 items-center"
                    >
                      <Select
                        value={line.ingredient_id ?? ""}
                        onValueChange={(val) =>
                          updateLineIngredient(line.id, val)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={line.raw_name || "Sin ingrediente"}
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
                        placeholder="Cantidad"
                        value={line.total_quantity ?? ""}
                        onChange={(e) =>
                          updateLineQuantity(
                            line.id,
                            e.target.value ? parseFloat(e.target.value) : null
                          )
                        }
                      />
                      <div className="text-sm text-muted-foreground">
                        {line.unit || "unidad"}
                        {line.confidence === "low" && (
                          <Badge variant="outline" className="ml-2">
                            Revisar
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={closeEditor}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={
                    !editedDraft.portions ||
                    editedDraft.lines.some(
                      (l) => !l.ingredient_id || !l.total_quantity
                    )
                  }
                >
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
