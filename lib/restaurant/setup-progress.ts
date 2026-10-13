// lib/restaurant/setup-progress.ts
//
// Shared onboarding step statuses for the giant checklist (Setup tab)
// and the compact Cockpit chip. Status rules live here once.

import type {
  DataQualityCounts,
  SetupCounts,
} from "@/lib/restaurant/profitability-server";

export type SetupStepStatus = "done" | "review" | "missing";

export type SetupStepId =
  | "pos"
  | "costs"
  | "menu"
  | "recipes"
  | "invoices"
  | "agents";

export interface SetupStepProgress {
  id: SetupStepId;
  status: SetupStepStatus;
  href: string;
}

export const SETUP_STEP_HREFS: Record<SetupStepId, string> = {
  pos: "/dashboard/restaurant/upload",
  costs: "/dashboard/restaurant/menu/recetas",
  menu: "/dashboard/restaurant/menu",
  recipes: "/dashboard/restaurant/menu",
  invoices: "/dashboard/restaurant/invoices",
  agents: "/dashboard/restaurant/agents",
};

const STEP_ORDER: SetupStepId[] = [
  "pos",
  "costs",
  "menu",
  "recipes",
  "invoices",
  "agents",
];

export function setupStepStatus(
  id: SetupStepId,
  s: SetupCounts,
  dq: DataQualityCounts
): SetupStepStatus {
  switch (id) {
    case "pos":
      return s.pos_sales_count > 0 ? "done" : "missing";
    case "costs":
      return s.cost_entries_count > 0 ? "done" : "missing";
    case "menu":
      if (s.menu_items_count === 0) return "missing";
      return dq.unmapped_pos_items > 0 ? "review" : "done";
    case "recipes":
      if (s.recipe_inputs_count === 0) return "missing";
      return dq.menu_items_without_recipe > 0 ? "review" : "done";
    case "invoices":
      return s.supplier_invoices_count > 0 ? "done" : "missing";
    case "agents":
      return s.agent_runs_count > 0 ? "done" : "missing";
  }
}

export function setupStepProgressList(
  s: SetupCounts,
  dq: DataQualityCounts
): SetupStepProgress[] {
  return STEP_ORDER.map((id) => ({
    id,
    status: setupStepStatus(id, s, dq),
    href: SETUP_STEP_HREFS[id],
  }));
}

export interface SetupProgress {
  done: number;
  total: number;
  complete: boolean;
  nextHref: string | null;
}

export function setupProgress(
  s: SetupCounts,
  dq: DataQualityCounts
): SetupProgress {
  const steps = setupStepProgressList(s, dq);
  const done = steps.filter((step) => step.status === "done").length;
  const next = steps.find((step) => step.status !== "done");
  return {
    done,
    total: steps.length,
    complete: done === steps.length,
    nextHref: next?.href ?? null,
  };
}
