// Parse an editor request body into a typed action. Anything malformed
// returns null; the route answers 400.

import type { EditorAction } from "./editor-service";

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function kindOf(raw: unknown): "ingredient" | "component" | null {
  return raw === "ingredient" || raw === "component" ? raw : null;
}

function num(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Turn the request body into a typed action, or null if it is malformed. */
export function parseEditorAction(
  body: Record<string, unknown>
): EditorAction | null {
  switch (body.action) {
    case "add": {
      const kind = kindOf(body.kind);
      const id = str(body.id);
      const unit = str(body.unit);
      const quantity = num(body.quantity);
      if (!kind || !id || !unit || quantity === undefined) return null;
      return { action: "add", kind, id, unit, quantity };
    }
    case "update": {
      const inputId = str(body.input_id);
      if (!inputId) return null;
      return {
        action: "update",
        input_id: inputId,
        quantity: num(body.quantity),
        unit: str(body.unit) ?? undefined,
      };
    }
    case "set_yield": {
      const unit = str(body.unit);
      const quantity = num(body.quantity);
      if (!unit || quantity === undefined) return null;
      return { action: "set_yield", quantity, unit };
    }
    case "answer_unit": {
      const inputId = str(body.input_id);
      const unit = str(body.unit);
      if (!inputId || !unit) return null;
      return { action: "answer_unit", input_id: inputId, unit };
    }
    case "change_item": {
      const inputId = str(body.input_id);
      const kind = kindOf(body.kind);
      const id = str(body.id);
      if (!inputId || !kind || !id) return null;
      return { action: "change_item", input_id: inputId, kind, id };
    }
    case "resolve": {
      const lineKey = str(body.line_key);
      const kind = kindOf(body.kind);
      const id = str(body.id);
      if (!lineKey || !kind || !id) return null;
      return {
        action: "resolve",
        line_key: lineKey,
        kind,
        id,
        quantity: num(body.quantity),
        line_unit: str(body.line_unit) ?? undefined,
      };
    }
    case "set_line_cost": {
      const inputId = str(body.input_id);
      if (!inputId) return null;
      if (body.unit_cost === null) {
        return { action: "set_line_cost", input_id: inputId, unit_cost: null };
      }
      const cost = num(body.unit_cost);
      if (cost === undefined) return null;
      return { action: "set_line_cost", input_id: inputId, unit_cost: cost };
    }
    case "remove": {
      const lineKey = str(body.line_key);
      return lineKey ? { action: "remove", line_key: lineKey } : null;
    }
    case "create_ingredient": {
      const name = str(body.name);
      const unit = str(body.unit);
      if (!name || !unit) return null;
      return {
        action: "create_ingredient",
        name,
        unit,
        unit_cost: num(body.unit_cost),
        line_key: str(body.line_key) ?? undefined,
        quantity: num(body.quantity),
        line_unit: str(body.line_unit) ?? undefined,
      };
    }
    case "set_price": {
      const id = str(body.ingredient_id);
      const unit = str(body.unit);
      const cost = num(body.unit_cost);
      if (!id || !unit || cost === undefined) return null;
      return {
        action: "set_price",
        ingredient_id: id,
        unit,
        unit_cost: cost,
        ...(body.adopt_legacy === true ? { adopt_legacy: true } : {}),
      };
    }
    case "answer_catalog_unit": {
      const itemId = str(body.item_id);
      const unit = str(body.unit);
      if (!itemId || !unit) return null;
      return {
        action: "answer_catalog_unit",
        item_id: itemId,
        unit,
        line_key: str(body.line_key) ?? undefined,
      };
    }
    case "create_preparation": {
      const name = str(body.name);
      const yieldUnit = str(body.yield_unit);
      const yieldQty = num(body.yield_quantity);
      if (!name || !yieldUnit || yieldQty === undefined) return null;
      return {
        action: "create_preparation",
        name,
        yield_quantity: yieldQty,
        yield_unit: yieldUnit,
        line_key: str(body.line_key) ?? undefined,
        quantity: num(body.quantity),
        line_unit: str(body.line_unit) ?? undefined,
      };
    }
    default:
      return null;
  }
}
