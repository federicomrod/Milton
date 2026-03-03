// lib/hooks/usePipelineData.ts
"use client";

import { useEffect, useState } from "react";
import type { Deal } from "@/lib/types/pipeline";
import type { PipelineMetrics } from "@/lib/types/pipeline";

export interface PipelineDateRange {
  from: string;
  to: string;
}

// Same pattern as fitness-studio/restaurant: fetch from analytics API (server-side data).
const PIPELINE_API = "/api/analytics/b2b-saas/pipeline";

export function usePipelineData(dateRange?: PipelineDateRange | null) {
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
    totalPipelineValue: 0,
    weightedPipelineValue: 0,
    activeCustomers: 0,
    dealConversionRate: 0,
    clientConcentrationPercent: 0,
  });
  const [totalRevenue, setTotalRevenue] = useState<number>(0);

  useEffect(() => {
    const loadCRMData = async () => {
      try {
        setLoading(true);
        const from =
          dateRange?.from ||
          new Date(new Date().setFullYear(new Date().getFullYear() - 10))
            .toISOString()
            .split("T")[0];
        const to = dateRange?.to || new Date().toISOString().split("T")[0];
        const url = `${PIPELINE_API}?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`;
        const res = await fetch(url, {
          cache: "no-store",
          credentials: "include",
        });

        if (!res.ok) {
          setDeals([]);
          setAllDeals([]);
          setMetrics({
            pipelineByPhase: [],
            dealsByProduct: [],
            averageSalesCycle: 0,
            conversionRates: [],
            topDeals: [],
            pipelineForecast: [],
            funnelData: [],
            totalPipelineValue: 0,
            weightedPipelineValue: 0,
            activeCustomers: 0,
            dealConversionRate: 0,
            clientConcentrationPercent: 0,
          });
          setTotalRevenue(0);
          setLoading(false);
          return;
        }

        const json = await res.json();
        const dealsData: Deal[] = Array.isArray(json.deals) ? json.deals : [];
        const defaultMetrics = {
          pipelineByPhase: [],
          dealsByProduct: [],
          averageSalesCycle: 0,
          conversionRates: [],
          topDeals: [],
          pipelineForecast: [],
          funnelData: [],
          totalPipelineValue: 0,
          weightedPipelineValue: 0,
          activeCustomers: 0,
          dealConversionRate: 0,
          clientConcentrationPercent: 0,
        };
        const calculatedMetrics = { ...defaultMetrics, ...json.metrics };

        setAllDeals(dealsData);
        setDeals(dealsData);
        setMetrics(calculatedMetrics);
        setTotalRevenue(Number(json.totalRevenue) || 0);
      } catch (error) {
        console.error("Error loading CRM data:", error);
        setDeals([]);
        setAllDeals([]);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    };

    loadCRMData();
  }, [dateRange?.from, dateRange?.to]);

  return {
    deals,
    allDeals,
    loading,
    metrics,
    totalRevenue,
  };
}
