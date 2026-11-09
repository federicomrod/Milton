// lib/restaurant/recipe-costing/editor-redact.ts
//
// What the recipe editor may send to a role. Line quantities and units stay for
// everyone who can open it; MONEY (prices, line amounts, totals, merma $, the
// price-list readings) goes only to roles with prices.view, and the editor is
// read-only unless the role may edit recipes (recipes.edit). Pure.

import type { EditorLine, PickerOption } from "./editor";
import type { EditorState } from "./editor-service";

export interface EditorViewer {
  canEdit: boolean;
  canViewPrices: boolean;
}

function withoutMoney(line: EditorLine): EditorLine {
  const {
    milton_price_estimate: _estimate,
    effective: _effective,
    ...rest
  } = line;
  void _estimate;
  void _effective;
  return {
    ...rest,
    unit_cost: null,
    amount: null,
    price: null,
    legacy_price: null,
    excel_unit_cost: null,
    catalog_question: null,
    own_cost: false,
    cost_source: null,
  };
}

const optionWithoutMoney = (o: PickerOption): PickerOption => ({
  ...o,
  unit_cost: null,
  price_date: null,
  price_source: null,
});

export function restrictEditorState(
  state: EditorState,
  viewer: EditorViewer,
  lockedReason: string
): EditorState {
  let out = state;
  if (!viewer.canViewPrices) {
    out = {
      ...out,
      money_hidden: true,
      lines: (out.lines ?? []).map(withoutMoney),
      options: (out.options ?? []).map(optionWithoutMoney),
      total_cost: null,
      ...(out.preparation
        ? {
            preparation: {
              ...out.preparation,
              cost_per_output_unit: null,
            },
          }
        : {}),
    };
  }
  if (!viewer.canEdit) {
    out = {
      ...out,
      editable: false,
      locked_reason: lockedReason,
      role_read_only: true,
    };
  }
  return out;
}
