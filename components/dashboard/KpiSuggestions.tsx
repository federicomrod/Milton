"use client";

import React from "react";
import { useBusinessContext } from "@/lib/business-context";
import { KPI_TEMPLATES } from "@/lib/kpi-templates";
import type { BusinessTypeId } from "@/lib/business-types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function KpiSuggestions() {
  const { businessType } = useBusinessContext();

  if (!businessType) {
    return null;
  }

  const templates = KPI_TEMPLATES[businessType as BusinessTypeId] ?? [];

  if (!templates.length) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          Recommended KPIs for your business type
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {templates.map((kpi) => (
          <div key={kpi.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{kpi.label}</span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {kpi.trendGoal === "increase"
                  ? "Higher is better"
                  : kpi.trendGoal === "decrease"
                    ? "Lower is better"
                    : "Keep stable"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{kpi.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
