// lib/hooks/useReportData.ts
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getUploadedFilesSummary } from "@/lib/data-service";

export interface DataStatus {
  hasTransactions: boolean;
  hasCRMData: boolean;
  hasBudgetData: boolean;
  hasAnyData: boolean;
}

export function useReportData() {
  const [isClient, setIsClient] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>({
    hasTransactions: false,
    hasCRMData: false,
    hasBudgetData: false,
    hasAnyData: false,
  });

  // Initialize client-side
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsClient(true);
  }, []);

  const checkDataAvailability = async (): Promise<DataStatus> => {
    // Early return if not on client side
    if (typeof window === "undefined") {
      return {
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasAnyData: false,
      };
    }

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return {
          hasTransactions: false,
          hasCRMData: false,
          hasBudgetData: false,
          hasAnyData: false,
        };
      }

      const summaries = await getUploadedFilesSummary(supabase, user.id);

      const hasTransactions =
        (summaries.find((s) => s.name === "transactions")?.count ?? 0) > 0;
      const hasCRMData =
        (summaries.find((s) => s.name === "crm_deals")?.count ?? 0) > 0;
      const hasBudgetData =
        (summaries.find((s) => s.name === "budgets")?.count ?? 0) > 0;

      return {
        hasTransactions,
        hasCRMData,
        hasBudgetData,
        hasAnyData: hasTransactions || hasCRMData || hasBudgetData,
      };
    } catch (error) {
      console.error("Error checking data availability:", error);
      return {
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasAnyData: false,
      };
    }
  };

  // Load data status after client is confirmed
  useEffect(() => {
    if (!isClient || typeof window === "undefined") {
      return;
    }

    const loadDataStatus = async () => {
      try {
        const status = await checkDataAvailability();
        setDataStatus(status);
      } catch (err) {
        console.error("[useReportData] Error loading data status:", err);
      }
    };

    loadDataStatus();
  }, [isClient]);

  return { isClient, dataStatus };
}
