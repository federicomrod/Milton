// lib/metric-availability-service.ts
// Service to check metric availability based on data status

import { createClient } from "@/lib/supabase/client";
import {
  getMetricDataRequirements,
  isMetricAvailable,
  getMissingDataSourcesForMetric,
  DataSource,
} from "./metric-data-requirements";

export interface DataAvailability {
  transactions: boolean;
  deals: boolean;
  budget: boolean;
  recordCounts?: {
    transactions?: number;
    deals?: number;
    budget?: number;
  };
}

export interface MetricAvailability {
  metricId: string;
  isAvailable: boolean;
  missingDataSources: DataSource[];
  description: string;
}

/**
 * Service to check which metrics are available based on user's data
 */
export class MetricAvailabilityService {
  /**
   * Check data availability for a user
   */
  static async getDataAvailability(userId: string): Promise<DataAvailability> {
    try {
      const supabase = createClient();

      // Get company ID
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", userId)
        .single();

      if (!company?.id) {
        return { transactions: false, deals: false, budget: false };
      }

      const companyId = company.id;

      // Get data status from the API
      const response = await fetch("/api/data/status", {
        credentials: "include",
      });

      let dataStatus = { bank: false, crm: false, budget: false };
      if (response.ok) {
        dataStatus = await response.json();
      }

      // Get record counts for minimum requirements
      const recordCounts: DataAvailability["recordCounts"] = {};

      // Count transactions
      if (dataStatus.bank) {
        const { count: transactionCount } = await supabase
          .from("model_data")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .ilike("model_table_name", "%transaction%");
        recordCounts.transactions = transactionCount || 0;
      }

      // Count deals
      if (dataStatus.crm) {
        const { count: dealCount } = await supabase
          .from("model_data")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .ilike("model_table_name", "%deal%");
        recordCounts.deals = dealCount || 0;
      }

      // Count budget records
      if (dataStatus.budget) {
        const { count: budgetCount } = await supabase
          .from("model_data")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .ilike("model_table_name", "%budget%");
        recordCounts.budget = budgetCount || 0;
      }

      return {
        transactions: dataStatus.bank,
        deals: dataStatus.crm,
        budget: dataStatus.budget,
        recordCounts,
      };
    } catch (error) {
      console.error("Error checking data availability:", error);
      return { transactions: false, deals: false, budget: false };
    }
  }

  /**
   * Check availability of specific metrics
   */
  static async getMetricAvailabilities(
    userId: string,
    metricIds: string[]
  ): Promise<MetricAvailability[]> {
    const dataAvailability = await this.getDataAvailability(userId);

    return metricIds.map((metricId) => {
      const requirement = getMetricDataRequirements(metricId);
      const missingSources = getMissingDataSourcesForMetric(
        metricId,
        {
          transactions: dataAvailability.transactions,
          deals: dataAvailability.deals,
          budget: dataAvailability.budget,
        },
        dataAvailability.recordCounts
      );

      return {
        metricId,
        isAvailable: missingSources.length === 0,
        missingDataSources: missingSources,
        description:
          requirement?.description || "Data requirements not defined",
      };
    });
  }

  /**
   * Get user-friendly message for missing data sources
   */
  static getMissingDataMessage(missingSources: DataSource[]): string {
    if (missingSources.length === 0) return "";

    const sourceNames: Record<DataSource, string> = {
      transactions: "transaction data",
      deals: "deal/pipeline data",
      budget: "budget data",
    };

    const sourceList = missingSources
      .map((source) => sourceNames[source])
      .join(", ");
    return `Missing ${sourceList}`;
  }

  /**
   * Get available metrics from a list
   */
  static async getAvailableMetrics(
    userId: string,
    metricIds: string[]
  ): Promise<string[]> {
    const availabilities = await this.getMetricAvailabilities(
      userId,
      metricIds
    );
    return availabilities
      .filter((availability) => availability.isAvailable)
      .map((availability) => availability.metricId);
  }
}
