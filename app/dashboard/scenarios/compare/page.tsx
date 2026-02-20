"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScenarioSelector } from "@/components/dashboard/scenarios/compare/ScenarioSelector";
import type { CompareScenario } from "@/components/dashboard/scenarios/compare/ScenarioSelector";
import { KPIComparisonGrid } from "@/components/dashboard/scenarios/compare/KPIComparisonGrid";
import type { KPIComparisonRow } from "@/components/dashboard/scenarios/compare/KPIComparisonGrid";
import { VisualComparison } from "@/components/dashboard/scenarios/compare/VisualComparison";
import { DriverDifferences } from "@/components/dashboard/scenarios/compare/DriverDifferences";
import type { DriverRow } from "@/components/dashboard/scenarios/compare/DriverDifferences";
import type { PlanningScenarioRow } from "@/lib/types/scenario";

const COMPARE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

function scenariosFromApi(rows: PlanningScenarioRow[]): CompareScenario[] {
  return rows.map((row, i) => ({
    id: row.id,
    name: row.name,
    locked: i === 0,
    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
  }));
}

const KPI_DATA: KPIComparisonRow[] = [
  {
    name: "Revenue",
    key: "revenue",
    values: {
      baseline: 2_400_000,
      "scenario-a": 2_650_000,
      "scenario-b": 2_100_000,
      "scenario-c": 2_850_000,
    },
  },
  {
    name: "Costs",
    key: "costs",
    values: {
      baseline: 1_800_000,
      "scenario-a": 1_900_000,
      "scenario-b": 1_650_000,
      "scenario-c": 2_100_000,
    },
  },
  {
    name: "Net Income",
    key: "netIncome",
    values: {
      baseline: 600_000,
      "scenario-a": 750_000,
      "scenario-b": 450_000,
      "scenario-c": 750_000,
    },
  },
  {
    name: "Cash Runway",
    key: "runway",
    values: {
      baseline: 18,
      "scenario-a": 22,
      "scenario-b": 14,
      "scenario-c": 20,
    },
  },
];

const CHART_DATA_RAW: Record<string, number | string>[] = [
  {
    month: "Jan",
    revenue_baseline: 180_000,
    revenue_scenarioa: 195_000,
    revenue_scenariob: 165_000,
    revenue_scenarioc: 210_000,
    cash_baseline: 850_000,
    cash_scenarioa: 920_000,
    cash_scenariob: 780_000,
    cash_scenarioc: 950_000,
    netIncome_baseline: 45_000,
    netIncome_scenarioa: 58_000,
    netIncome_scenariob: 32_000,
    netIncome_scenarioc: 62_000,
  },
  {
    month: "Feb",
    revenue_baseline: 190_000,
    revenue_scenarioa: 208_000,
    revenue_scenariob: 172_000,
    revenue_scenarioc: 225_000,
    cash_baseline: 880_000,
    cash_scenarioa: 965_000,
    cash_scenariob: 795_000,
    cash_scenarioc: 1_000_000,
    netIncome_baseline: 48_000,
    netIncome_scenarioa: 62_000,
    netIncome_scenariob: 35_000,
    netIncome_scenarioc: 67_000,
  },
  {
    month: "Mar",
    revenue_baseline: 195_000,
    revenue_scenarioa: 215_000,
    revenue_scenariob: 170_000,
    revenue_scenarioc: 232_000,
    cash_baseline: 915_000,
    cash_scenarioa: 1_010_000,
    cash_scenariob: 805_000,
    cash_scenarioc: 1_050_000,
    netIncome_baseline: 50_000,
    netIncome_scenarioa: 65_000,
    netIncome_scenariob: 36_000,
    netIncome_scenarioc: 70_000,
  },
  {
    month: "Apr",
    revenue_baseline: 200_000,
    revenue_scenarioa: 220_000,
    revenue_scenariob: 175_000,
    revenue_scenarioc: 237_000,
    cash_baseline: 950_000,
    cash_scenarioa: 1_055_000,
    cash_scenariob: 820_000,
    cash_scenarioc: 1_095_000,
    netIncome_baseline: 51_000,
    netIncome_scenarioa: 67_000,
    netIncome_scenariob: 37_000,
    netIncome_scenarioc: 72_000,
  },
  {
    month: "May",
    revenue_baseline: 205_000,
    revenue_scenarioa: 228_000,
    revenue_scenariob: 178_000,
    revenue_scenarioc: 245_000,
    cash_baseline: 980_000,
    cash_scenarioa: 1_100_000,
    cash_scenariob: 835_000,
    cash_scenarioc: 1_145_000,
    netIncome_baseline: 52_000,
    netIncome_scenarioa: 70_000,
    netIncome_scenariob: 38_000,
    netIncome_scenarioc: 75_000,
  },
  {
    month: "Jun",
    revenue_baseline: 210_000,
    revenue_scenarioa: 235_000,
    revenue_scenariob: 182_000,
    revenue_scenarioc: 252_000,
    cash_baseline: 1_015_000,
    cash_scenarioa: 1_150_000,
    cash_scenariob: 852_000,
    cash_scenarioc: 1_200_000,
    netIncome_baseline: 54_000,
    netIncome_scenarioa: 73_000,
    netIncome_scenariob: 40_000,
    netIncome_scenarioc: 78_000,
  },
];

const DRIVERS_MOCK_VALUES = [
  ["100/month", "125/month", "85/month", "140/month"],
  ["$1,200", "$1,350", "$1,100", "$1,400"],
  ["25", "28", "22", "32"],
  ["$45K/mo", "$52K/mo", "$38K/mo", "$60K/mo"],
  ["3.5%", "2.8%", "4.2%", "2.5%"],
];
const DRIVERS_MOCK_NAMES = [
  "Customer acquisition rate",
  "Average deal size",
  "Team headcount",
  "Marketing spend",
  "Churn rate",
];

export default function CompareScenariosPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<CompareScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scenarios", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScenarios([]);
        return;
      }
      const raw = (data.scenarios ?? data) as PlanningScenarioRow[];
      const list = Array.isArray(raw) ? raw : [];
      setScenarios(scenariosFromApi(list));
    } catch {
      setScenarios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  useEffect(() => {
    if (scenarios.length > 0 && selectedScenarios.length === 0) {
      setSelectedScenarios(scenarios.slice(0, 3).map((s) => s.id));
    }
  }, [scenarios]);

  const activeScenarios = useMemo(
    () => scenarios.filter((s) => selectedScenarios.includes(s.id)),
    [scenarios, selectedScenarios]
  );

  const baselineId = scenarios[0]?.id ?? "";

  const kpiDataForKeyedScenarios = useMemo((): KPIComparisonRow[] => {
    const ids = activeScenarios.map((s) => s.id);
    if (ids.length === 0) return [];
    const mockByIndex = [
      [2_400_000, 2_650_000, 2_100_000, 2_850_000],
      [1_800_000, 1_900_000, 1_650_000, 2_100_000],
      [600_000, 750_000, 450_000, 750_000],
      [18, 22, 14, 20],
    ];
    const keys: { name: string; key: string }[] = [
      { name: "Revenue", key: "revenue" },
      { name: "Costs", key: "costs" },
      { name: "Net Income", key: "netIncome" },
      { name: "Cash Runway", key: "runway" },
    ];
    return keys.map(({ name, key }, rowIdx) => ({
      name,
      key,
      values: Object.fromEntries(
        ids.map((id, i) => [id, mockByIndex[rowIdx][Math.min(i, 3)] ?? 0])
      ),
    }));
  }, [activeScenarios]);

  const transformedChartData = useMemo(() => {
    const scenarioKeys = ["baseline", "scenarioa", "scenariob", "scenarioc"];
    return CHART_DATA_RAW.map((item) => {
      const newItem: Record<string, number | string> = {
        month: item.month as string,
      };
      (["revenue", "cash", "netIncome"] as const).forEach((k) => {
        activeScenarios.forEach((scenario, i) => {
          const sk = scenarioKeys[Math.min(i, scenarioKeys.length - 1)];
          newItem[`${k}_${scenario.id}`] = (item[`${k}_${sk}`] as number) ?? 0;
        });
      });
      return newItem;
    });
  }, [activeScenarios]);

  const driversForKeyedScenarios = useMemo((): DriverRow[] => {
    const ids = activeScenarios.map((s) => s.id);
    if (ids.length === 0) return [];
    return DRIVERS_MOCK_NAMES.map((name, rowIdx) => ({
      name,
      values: Object.fromEntries(
        ids.map((id, i) => [
          id,
          DRIVERS_MOCK_VALUES[rowIdx][Math.min(i, 3)] ?? "—",
        ])
      ),
    }));
  }, [activeScenarios]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading scenarios…</p>
        </div>
      </div>
    );
  }

  if (scenarios.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground mb-6">
              Compare Scenarios
            </h1>
            <p className="text-muted-foreground mb-4">
              No scenarios yet. Create scenarios and run simulations to compare
              them.
            </p>
            <Button
              variant="ghost"
              className="gap-2 -ml-2"
              onClick={() => router.push("/dashboard/scenarios")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to scenarios
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-6">
            Compare Scenarios
          </h1>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <ScenarioSelector
              scenarios={scenarios}
              selectedScenarios={selectedScenarios}
              onSelectionChange={setSelectedScenarios}
            />

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add scenario
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export comparison
              </Button>
            </div>
          </div>
        </div>

        {selectedScenarios.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              KPI Comparison
            </h2>
            <KPIComparisonGrid
              scenarios={activeScenarios}
              kpiData={kpiDataForKeyedScenarios}
              baselineId={baselineId}
            />
          </div>
        )}

        {selectedScenarios.length > 0 && (
          <div className="mb-8">
            <VisualComparison
              scenarios={activeScenarios.map((s) => ({
                id: s.id,
                name: s.name,
                color: s.color ?? "#6b7280",
              }))}
              data={transformedChartData}
            />
          </div>
        )}

        {selectedScenarios.length > 1 && (
          <div className="mb-8">
            <DriverDifferences
              scenarios={activeScenarios}
              drivers={driversForKeyedScenarios}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border">
          <Button
            variant="ghost"
            className="gap-2 -ml-2"
            onClick={() => router.push("/dashboard/scenarios")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to scenarios
          </Button>

          <Button className="gap-2">
            <Check className="h-4 w-4" />
            Select preferred scenario
          </Button>
        </div>
      </div>
    </div>
  );
}
