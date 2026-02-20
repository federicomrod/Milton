"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ScenarioEditor } from "@/components/dashboard/scenarios/ScenarioEditor";
import {
  businessTypeToTemplateKey,
  getDriverSectionsForBusinessModel,
  mergeDriverOverrides,
} from "@/lib/scenario-drivers";
import {
  parseDriverOverrides,
  type PlanningScenarioRow,
} from "@/lib/types/scenario";
import type { DriverSection } from "@/lib/scenario-drivers";

export default function ScenarioEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [scenario, setScenario] = useState<PlanningScenarioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      try {
        const [scenarioRes, authData] = await Promise.all([
          fetch(`/api/scenarios/${id}`, { credentials: "include" }),
          (async () => {
            const { createClient } = await import("@/lib/supabase/client");
            const supabase = createClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (!user) return null;
            const { data: company } = await supabase
              .from("companies")
              .select("id")
              .eq("created_by", user.id)
              .single();
            if (!company) return null;
            const { data: businessModel } = await supabase
              .from("business_models")
              .select("business_type")
              .eq("company_id", company.id)
              .single();
            return {
              businessType: (businessModel?.business_type as string) ?? null,
            };
          })(),
        ]);

        const scenarioData = await scenarioRes.json().catch(() => ({}));
        if (!scenarioRes.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setScenario(scenarioData.scenario as PlanningScenarioRow);
        if (authData?.businessType != null) {
          setBusinessType(authData.businessType);
        }
      } catch (err) {
        console.error("[ScenarioEditPage] Error loading:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const templateSections =
    businessType != null
      ? getDriverSectionsForBusinessModel(businessType)
      : getDriverSectionsForBusinessModel(null);
  const overrides = scenario
    ? parseDriverOverrides(scenario.driver_overrides)
    : [];
  const initialSections = mergeDriverOverrides(templateSections, overrides);

  const handleSave = useCallback(
    async (name: string, sections: DriverSection[]) => {
      if (!id) return;
      const payload = {
        name: name.trim() || "New Scenario",
        driver_overrides: sections,
      };
      const res = await fetch(`/api/scenarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setScenario((prev) => (prev ? { ...prev, name: payload.name } : null));
      }
    },
    [id]
  );

  const handleSaveDriverOverrides = async (
    sections: DriverSection[],
    currentName?: string
  ) => {
    if (!id) return;
    const body: { driver_overrides: DriverSection[]; name?: string } = {
      driver_overrides: sections,
    };
    if (currentName != null && currentName.trim() !== "") {
      body.name = currentName.trim();
    }
    const res = await fetch(`/api/scenarios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.ok && body.name != null) {
      setScenario((prev) => (prev ? { ...prev, name: body.name! } : null));
    }
  };

  const handleSimulationComplete = async () => {
    if (!id) return;
    await fetch(`/api/scenarios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        status: "Projected",
        projected_results: {},
      }),
    });
    router.push(`/dashboard/scenarios/${id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading scenario...</p>
        </div>
      </div>
    );
  }

  if (notFound || !scenario) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          className="gap-2 mb-6"
          onClick={() => router.push("/dashboard/scenarios")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to scenarios
        </Button>
        <p className="text-muted-foreground">Scenario not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-background px-4 sm:px-6 lg:px-8 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 -ml-2"
          onClick={() => router.push("/dashboard/scenarios")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to scenarios
        </Button>
      </div>
      <ScenarioEditor
        businessType={businessType}
        businessModelDisplayName={businessTypeToTemplateKey(businessType)}
        scenarioName={scenario.name}
        status={
          scenario.status === "Draft" ||
          scenario.status === "Projected" ||
          scenario.status === "Ready"
            ? scenario.status
            : "Draft"
        }
        initialSections={initialSections}
        onSave={handleSave}
        onSaveDriverOverrides={handleSaveDriverOverrides}
        onSimulationComplete={handleSimulationComplete}
      />
    </div>
  );
}
