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

        // Fetch all deals (Supabase has a default limit of 1000, so we need to explicitly request more)
        let allDealsData: any[] = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from("crm_deals")
            .select("*")
            .eq("user_id", user.id)
            .range(from, from + pageSize - 1)
            .order("id", { ascending: true });

          if (error) {
            console.error("Failed to load CRM deals:", error);
            setLoading(false);
            return;
          }

          if (data && data.length > 0) {
            allDealsData = [...allDealsData, ...data];
            from += pageSize;
            hasMore = data.length === pageSize; // If we got a full page, there might be more
          } else {
            hasMore = false;
          }
        }

        const { error } = { error: null }; // Keep for compatibility

        const dealsData: Deal[] = (allDealsData || []) as Deal[];

        console.log(`[usePipelineData] Loaded ${dealsData.length} CRM deals`);

        // Log stage distribution for debugging
        const stageCounts = dealsData.reduce(
          (acc, deal) => {
            const stage = deal.stage || deal.phase || "unknown";
            acc[stage] = (acc[stage] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
        console.log(`[usePipelineData] Stage distribution:`, stageCounts);

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
