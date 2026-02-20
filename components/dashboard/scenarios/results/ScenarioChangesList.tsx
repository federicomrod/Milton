"use client";

import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface ScenarioChangeItem {
  driver: string;
  category: string;
  baseline: string;
  scenario: string;
}

function ChangeItem({
  driver,
  baseline,
  scenario,
  category,
}: ScenarioChangeItem) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{driver}</p>
        <p className="text-sm text-muted-foreground">{category}</p>
      </div>

      <div className="flex items-center gap-4 text-foreground">
        <div className="text-right min-w-[100px]">
          <p className="text-sm text-muted-foreground">Baseline</p>
          <p>{baseline}</p>
        </div>

        <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />

        <div className="text-right min-w-[100px]">
          <p className="text-sm text-muted-foreground">Scenario</p>
          <p>{scenario}</p>
        </div>
      </div>
    </div>
  );
}

interface ScenarioChangesListProps {
  changes?: ScenarioChangeItem[];
}

const defaultChanges: ScenarioChangeItem[] = [
  {
    driver: "Market Expansion",
    baseline: "North America only",
    scenario: "NA + APAC",
    category: "Geography",
  },
  {
    driver: "Customer Acquisition Cost",
    baseline: "$120",
    scenario: "$180",
    category: "Marketing",
  },
  {
    driver: "Average Deal Size",
    baseline: "$5,000",
    scenario: "$6,500",
    category: "Sales",
  },
  {
    driver: "Sales Team Size",
    baseline: "12 reps",
    scenario: "18 reps",
    category: "Headcount",
  },
  {
    driver: "Monthly Churn Rate",
    baseline: "3.5%",
    scenario: "2.8%",
    category: "Retention",
  },
  {
    driver: "Initial Investment",
    baseline: "$0",
    scenario: "$500K",
    category: "Capital",
  },
];

export function ScenarioChangesList({
  changes = defaultChanges,
}: ScenarioChangesListProps) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-2">
        What Changed vs Baseline
      </h2>
      <p className="text-muted-foreground mb-6">
        Key assumptions and inputs modified in this scenario
      </p>

      <div className="space-y-0">
        {changes.map((change, index) => (
          <ChangeItem key={`${change.driver}-${index}`} {...change} />
        ))}
      </div>
    </Card>
  );
}
