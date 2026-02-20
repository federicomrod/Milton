"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ScenarioResultsHeader } from "@/components/dashboard/scenarios/results/ScenarioResultsHeader";
import { ScenarioKPISummary } from "@/components/dashboard/scenarios/results/ScenarioKPISummary";
import type { ScenarioKPI } from "@/components/dashboard/scenarios/results/ScenarioKPISummary";
import { ScenarioTimeSeriesChart } from "@/components/dashboard/scenarios/results/ScenarioTimeSeriesChart";
import type { ScenarioChartMetric } from "@/components/dashboard/scenarios/results/ScenarioTimeSeriesChart";
import { ScenarioChangesList } from "@/components/dashboard/scenarios/results/ScenarioChangesList";
import type { ScenarioChangeItem } from "@/components/dashboard/scenarios/results/ScenarioChangesList";
import type { PlanningScenarioRow } from "@/lib/types/scenario";

const defaultKpis: ScenarioKPI[] = [
  {
    title: "Revenue",
    value: "$8.4M",
    delta: "$2.1M",
    deltaPercent: "+33%",
    isPositive: true,
  },
  {
    title: "Costs",
    value: "$4.8M",
    delta: "$1.2M",
    deltaPercent: "+25%",
    isPositive: false,
  },
  {
    title: "Net Income",
    value: "$3.6M",
    delta: "$900K",
    deltaPercent: "+33%",
    isPositive: true,
  },
  {
    title: "Cash Runway",
    value: "18 months",
    delta: "+3 months",
    deltaPercent: "+20%",
    isPositive: true,
  },
];

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

export default function ScenarioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [selectedMetric, setSelectedMetric] =
    useState<ScenarioChartMetric>("revenue");
  const [scenario, setScenario] = useState<PlanningScenarioRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    (async () => {
      let done = true;
      try {
        const res = await fetch(`/api/scenarios/${id}`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.scenario) {
          const s = data.scenario as PlanningScenarioRow;
          // Results page only makes sense after running the simulation
          if (s.status === "Draft") {
            router.replace(`/dashboard/scenarios/${id}/edit`);
            done = false;
            return;
          }
          setScenario(s);
        } else {
          setScenario(null);
        }
      } catch {
        setScenario(null);
      } finally {
        if (done) setLoading(false);
      }
    })();
  }, [id, router]);

  const handleEditAssumptions = () => {
    router.push(`/dashboard/scenarios/${id}/edit`);
  };

  const handleDuplicate = () => {
    router.push("/dashboard/scenarios");
  };

  const kpis: ScenarioKPI[] =
    scenario?.projected_results?.kpis &&
    scenario.projected_results.kpis.length > 0
      ? scenario.projected_results.kpis
      : defaultKpis;

  const changes: ScenarioChangeItem[] =
    scenario?.projected_results?.changes &&
    scenario.projected_results.changes.length > 0
      ? scenario.projected_results.changes
      : defaultChanges;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading scenario…</p>
        </div>
      </div>
    );
  }

  const scenarioName = scenario?.name ?? (id ? `Scenario ${id}` : "Scenario");
  const status = scenario?.status ?? "Projected";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        <ScenarioResultsHeader
          scenarioName={scenarioName}
          status={status}
          description="Impact analysis vs baseline scenario"
          onEditAssumptions={handleEditAssumptions}
          onDuplicate={handleDuplicate}
          onCompareScenarios={() => router.push("/dashboard/scenarios/compare")}
        />

        <ScenarioKPISummary kpis={kpis} />

        <ScenarioTimeSeriesChart
          selectedMetric={selectedMetric}
          onMetricChange={setSelectedMetric}
        />

        <ScenarioChangesList changes={changes} />

        <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border">
          <Button
            variant="ghost"
            className="gap-2 -ml-2"
            onClick={() => router.push("/dashboard/scenarios")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to scenarios
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard/scenarios/compare")}
          >
            Compare with another scenario
          </Button>
        </div>
      </div>
    </div>
  );
}
