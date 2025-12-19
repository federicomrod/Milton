// lib/hooks/useCashFlowData.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TransactionData } from "@/lib/types/data";
import {
  normalizeTransactions,
  calculateCashFlowMetrics,
  type Transaction,
  type CashFlowMetrics,
} from "@/lib/cash-flow-data-generators";

export function useCashFlowData() {
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

        const { data, error } = await supabase
          .from("transactions")
          .select("id, date, amount, category, name, description")
          .eq("user_id", user.id)
          .order("date", { ascending: false });

        if (error) {
          console.error("Failed to load transactions:", error);
          setLoading(false);
          return;
        }

        // Normalize and calculate metrics
        const txData = normalizeTransactions(data || []);
        const calculatedMetrics = calculateCashFlowMetrics(txData);

        setTransactions(txData);
        setMetrics(calculatedMetrics);
        setLoading(false);
      } catch (error) {
        console.error("Error loading transaction data:", error);
        setLoading(false);
      }
    };

    loadTransactionData();
  }, []);

  return {
    transactions,
    loading,
    metrics,
  };
}
