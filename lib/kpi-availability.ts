// lib/kpi-availability.ts
// Evaluates which KPIs can be calculated based on the data model

import type { BusinessTypeId } from "@/lib/business-types";
import type { ModelProposal } from "@/lib/ai/business-model-analyzer-types";
import type { KpiTemplate } from "@/lib/kpi-templates";

export type KpiAvailabilityStatus = "available" | "requiresData";

export interface KpiAvailability {
  id: string;
  status: KpiAvailabilityStatus;
  reason?: string;
}

function modelHasTable(
  model: ModelProposal | null | undefined,
  tableId: string,
): boolean {
  if (!model) return false;
  return (
    model.recommendedTables?.some(
      (t) => t.name?.toLowerCase() === tableId.toLowerCase(),
    ) ?? false
  );
}

export function evaluateKpiAvailability(
  businessType: BusinessTypeId,
  model: ModelProposal | null | undefined,
  templates: KpiTemplate[],
): KpiAvailability[] {
  return templates.map((tpl) => {
    // Very simple v1 rules. We can refine later.
    if (businessType === "fitness_studio") {
      if (
        tpl.id === "class_utilization" ||
        tpl.id === "avg_attendance_per_class"
      ) {
        const ok =
          modelHasTable(model, "bookings") && modelHasTable(model, "classes");
        return ok
          ? { id: tpl.id, status: "available" }
          : {
              id: tpl.id,
              status: "requiresData",
              reason: "Requires bookings linked to classes (with capacity).",
            };
      }

      if (tpl.id === "cancellation_rate") {
        const ok = modelHasTable(model, "bookings");
        return ok
          ? { id: tpl.id, status: "available" }
          : {
              id: tpl.id,
              status: "requiresData",
              reason:
                "Requires a bookings table with status/cancellation info.",
            };
      }

      if (tpl.id === "instructor_margin") {
        const ok =
          modelHasTable(model, "bookings") &&
          modelHasTable(model, "instructors");
        return ok
          ? { id: tpl.id, status: "available" }
          : {
              id: tpl.id,
              status: "requiresData",
              reason:
                "Requires instructors and bookings linked to them plus their cost.",
            };
      }

      if (tpl.id === "pack_membership_sales") {
        const ok = modelHasTable(model, "payments");
        return ok
          ? { id: tpl.id, status: "available" }
          : {
              id: tpl.id,
              status: "requiresData",
              reason: "Requires a payments or membership sales table.",
            };
      }
    }

    // For SaaS and Agency, or unhandled fitness KPIs: assume available for now
    // In v2, we can add more sophisticated checks
    return { id: tpl.id, status: "available" };
  });
}
