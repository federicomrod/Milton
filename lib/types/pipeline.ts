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
  /** Total pipeline value (active deals only) */
  totalPipelineValue: number;
  /** Weighted pipeline value (amount * stage probability) */
  weightedPipelineValue: number;
  /** Unique clients with active deals */
  activeCustomers: number;
  /** Win rate: closed won / (closed won + closed lost) as 0–100 */
  dealConversionRate: number;
  /** Top client's share of pipeline value as 0–100 */
  clientConcentrationPercent: number;
}
