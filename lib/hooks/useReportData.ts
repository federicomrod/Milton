// lib/hooks/useReportData.ts
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getUploadedFilesSummary, type FileSummary } from "@/lib/data-service";
import { useUser } from "@/lib/context/UserContext";

export interface DataStatus {
  modelTables: FileSummary[];
  hasTransactions: boolean;
  hasCRMData: boolean;
  hasBudgetData: boolean;
  hasMembers: boolean;
  hasAnyData: boolean;
}

export function useReportData() {
  const { user } = useUser();
  const [isClient, setIsClient] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>({
    modelTables: [],
    hasTransactions: false,
    hasCRMData: false,
    hasBudgetData: false,
    hasMembers: false,
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
        modelTables: [],
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasMembers: false,
        hasAnyData: false,
      };
    }

    try {
      if (!user) {
        return {
          modelTables: [],
          hasTransactions: false,
          hasCRMData: false,
          hasBudgetData: false,
          hasMembers: false,
          hasAnyData: false,
        };
      }

      const supabase = createClient();

      const modelTables = await getUploadedFilesSummary(supabase, user.id);

      // Check for different types of data based on table names
      const hasTransactions = modelTables.some(
        (t) =>
          [
            "transactions",
            "payments",
            "bank",
            "revenue",
            "expenses",
            "payroll",
          ].includes(t.name) && t.count > 0
      );
      const hasCRMData = modelTables.some(
        (t) =>
          [
            "deals",
            "crm",
            "opportunities",
            "leads",
            "customers",
            "sales",
          ].includes(t.name) && t.count > 0
      );
      const hasBudgetData = modelTables.some(
        (t) => ["budgets", "budget", "forecast"].includes(t.name) && t.count > 0
      );
      const hasMembers = modelTables.some(
        (t) => ["members", "customers"].includes(t.name) && t.count > 0
      );

      return {
        modelTables,
        hasTransactions,
        hasCRMData,
        hasBudgetData,
        hasMembers,
        hasAnyData: modelTables.some((t) => t.count > 0),
      };
    } catch (error) {
      console.error("Error checking data availability:", error);
      return {
        modelTables: [],
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasMembers: false,
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
  }, [isClient, user]);

  return { isClient, dataStatus };
}
