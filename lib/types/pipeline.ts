// lib/types/pipeline.ts
import type { CrmDealData } from "./data";

export interface Deal extends CrmDealData {
  id: string;
  amount: number;
  stage: string;
}

export interface PipelineMetrics {
  pipelineByPhase: Array<{
    phase: string;
    count: number;
    value: number;
    avgValue: number;
  }>;
  dealsByProduct: Array<{
    product: string;
    value: number;
  }>;
  averageSalesCycle: number;
  conversionRates: Array<{
    phase: string;
    rate: number;
  }>;
  topDeals: Array<{
    name: string;
    client: string;
    amount: number;
    phase: string;
    id: string;
  }>;
  pipelineForecast: Array<{
    month: string;
    [key: string]: string | number;
  }>;
  funnelData: Array<{
    phase: string;
    count: number;
    cumulativeCount: number;
    value: number;
    percentage: string;
    avgDealSize: number;
  }>;
}
