// lib/hooks/useCashFlowData.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getReportData } from "@/lib/report-data-service";
import {
  normalizeTransactions,
  calculateCashFlowMetrics,
  type Transaction,
  type CashFlowMetrics,
} from "@/lib/cash-flow-data-generators";

export function useCashFlowData(
  period: "month" | "year" | "ytd" | "custom" = "month",
  customDateRange?: { from: string; to: string }
) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<CashFlowMetrics>({
    currentBalance: 0,
    monthlyFlow: [],
    categoryBreakdown: [],
    runwayMonths: 0,
    burnRate: 0,
  });

  useEffect(() => {
    const loadTransactionData = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setLoading(false);
          return;
        }

        const reportData = await getReportData(supabase, user.id);

        if (!reportData.transactions || reportData.transactions.length === 0) {
          setLoading(false);
          return;
        }

        // Normalize transactions
        const txData = normalizeTransactions(reportData.transactions);

        // Calculate date range based on period
        let toDate = new Date();
        let fromDate = new Date();

        if (period === "year") {
          fromDate = new Date(new Date().getFullYear() - 1, 0, 1); // January 1st of last year
          toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59); // December 31st of last year
        } else if (period === "ytd") {
          fromDate = new Date(new Date().getFullYear(), 0, 1); // January 1st of current year
        } else if (period === "custom" && customDateRange) {
          fromDate = new Date(customDateRange.from);
          toDate = new Date(customDateRange.to);
        } else {
          // month - default to current month
          fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
        }

        // Set time components for accurate filtering
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);

        // Filter transactions by date range
        const filteredTransactions = txData.filter((tx) => {
          try {
            const date = new Date(tx.date);
            return date >= fromDate && date <= toDate && !isNaN(date.getTime());
          } catch {
            return false;
          }
        });

        // Calculate metrics with filtered data
        const calculatedMetrics =
          calculateCashFlowMetrics(filteredTransactions);

        setTransactions(filteredTransactions);
        setMetrics(calculatedMetrics);
        setLoading(false);
      } catch (error) {
        console.error("Error loading transaction data:", error);
        setLoading(false);
      }
    };

    loadTransactionData();
  }, [period, customDateRange]);

  return {
    transactions,
    loading,
    metrics,
  };
}
