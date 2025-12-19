// lib/hooks/usePipelineData.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Deal } from "@/lib/types/pipeline";
import { calculatePipelineMetrics } from "@/lib/pipeline-data-generators";
import type { PipelineMetrics } from "@/lib/types/pipeline";

export function usePipelineData() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PipelineMetrics>({
    pipelineByPhase: [],
    dealsByProduct: [],
    averageSalesCycle: 0,
    conversionRates: [],
    topDeals: [],
    pipelineForecast: [],
    funnelData: [],
  });

  useEffect(() => {
    const loadCRMData = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("crm_deals")
          .select("*")
          .eq("user_id", user.id);

        if (error) {
          console.error("Failed to load CRM deals:", error);
          setLoading(false);
          return;
        }

        const dealsData: Deal[] = (data || []) as Deal[];
        setAllDeals(dealsData);
        setDeals(dealsData);

        // Calculate metrics
        const calculatedMetrics = calculatePipelineMetrics(dealsData);
        setMetrics(calculatedMetrics);
        setLoading(false);
      } catch (error) {
        console.error("Error loading CRM data:", error);
        setLoading(false);
      }
    };

    loadCRMData();
  }, []);

  return {
    deals,
    allDeals,
    loading,
    metrics,
  };
}
