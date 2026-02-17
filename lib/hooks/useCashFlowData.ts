// lib/hooks/useCashFlowData.ts
"use client";

import { useEffect, useState } from "react";
import {
  normalizeTransactions,
  calculateCashFlowMetrics,
  type Transaction,
  type CashFlowMetrics,
} from "@/lib/cash-flow-data-generators";
import type { TransactionData } from "@/lib/types/data";

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

        const fromDateStr = fromDate.toISOString().split("T")[0];
        const toDateStr = toDate.toISOString().split("T")[0];

        // Fetch transactions from API
        const response = await fetch(
          `/api/analytics/fitness-studio/cash-flow?period=${period}&from_date=${fromDateStr}&to_date=${toDateStr}`,
          { cache: "no-store", credentials: "include" }
        );

        if (!response.ok) {
          console.error("[useCashFlowData] API error:", response.status);
          setTransactions([]);
          setMetrics({
            currentBalance: 0,
            monthlyFlow: [],
            categoryBreakdown: [],
            runwayMonths: 0,
            burnRate: 0,
          });
          setLoading(false);
          return;
        }

        const json = await response.json();
        const transactionData: TransactionData[] = json.transactions || [];

        // Normalize transactions
        const txData = normalizeTransactions(transactionData);

        // Calculate metrics with filtered data
        const calculatedMetrics = calculateCashFlowMetrics(txData);

        setTransactions(txData);
        setMetrics(calculatedMetrics);
        setLoading(false);
      } catch (error) {
        console.error("Error loading transaction data:", error);
        setTransactions([]);
        setMetrics({
          currentBalance: 0,
          monthlyFlow: [],
          categoryBreakdown: [],
          runwayMonths: 0,
          burnRate: 0,
        });
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
