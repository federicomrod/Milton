"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Activity,
  Users,
  Target,
  Wallet,
  Percent,
  Calendar,
  Zap,
} from "lucide-react";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { useUser } from "@/lib/context/UserContext";
import {
  formatCurrency as formatCurrencyUtil,
  formatNumber,
  formatPercentage,
} from "@/lib/utils/formatters";
import { getReportData } from "@/lib/report-data-service";
import { createClient } from "@/lib/supabase/client";
import type { TransactionData, CrmDealData } from "@/lib/types/data";

interface Transaction {
  id: string;
  date: string;
  name?: string;
  description?: string;
  amount: number;
  reference: string;
  category: string;
}

interface Deal {
  id: string;
  dealName: string;
  phase: string;
  amount: number;
  clientName: string;
  firstAppointment: string;
  closingDate: string;
  product: string;
}

interface Metrics {
  mrr: number;
  arr: number;
  cashBalance: number;
  burnRate: number;
  burnRateLTM: number;
  burnVariance: number;
  ltmRevenue: number;
  contractedRevenue: number;
  grossMargin: number;
  netMargin: number;
  customerCount: number;
  cac: number | null;
  ltv: number | null;
  churn: number | null;
  nps: number | null;
  runway: number;
  quickRatio: number | null;
}

interface MetricsGridProps {
  selectedMetrics?: string[];
  period?: "month" | "year" | "ytd" | "custom";
  customDateRange?: { from: string; to: string };
}

interface MetricCard {
  id: string;
  title: string;
  value: number | null;
  format: "currency" | "percentage" | "number" | "months";
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  suffix?: string;
}

export function MetricsGrid({
  selectedMetrics = [
    "mrr",
    "arr",
    "cashBalance",
    "burnRate",
    "contracted",
    "ltmRevenue",
    "grossMargin",
    "customers",
  ],
  period = "month",
  customDateRange,
}: MetricsGridProps) {
  const { user } = useUser();
  const { prefs } = useUserPreferences();
  const [metrics, setMetrics] = useState<Metrics>({
    mrr: 0,
    arr: 0,
    cashBalance: 0,
    burnRate: 0,
    burnRateLTM: 0,
    burnVariance: 0,
    ltmRevenue: 0,
    contractedRevenue: 0,
    grossMargin: 0,
    netMargin: 0,
    customerCount: 0,
    cac: null,
    ltv: null,
    churn: null,
    nps: null,
    runway: 0,
    quickRatio: null,
  });

  // Safe helper functions with proper null/undefined checks
  const safeToString = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const safeToLowerCase = (value: unknown): string => {
    return safeToString(value).toLowerCase();
  };

  const safeParseFloat = (value: unknown): number => {
    if (value === null || value === undefined) return 0;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? 0 : parsed;
  };

  // Helper function to classify revenue types with safe string handling
  const isRecurringRevenue = (category: unknown): boolean => {
    if (!category) return false;
    const categoryStr = safeToLowerCase(category);
    const recurringCategories = [
      "subscription",
      "monthly",
      "recurring",
      "mrr",
      "wiederk",
    ];
    return recurringCategories.some((cat) => categoryStr.includes(cat));
  };

  const isRevenue = (category: unknown): boolean => {
    if (!category) return false;
    const categoryStr = safeToLowerCase(category);
    const revenueCategories = [
      "subscription",
      "consulting",
      "one-time service",
      "service",
      "sales",
      "revenue",
      "wiederk",
    ];
    return revenueCategories.some((cat) => categoryStr.includes(cat));
  };

  const isCOGS = (category: unknown): boolean => {
    if (!category) return false;
    const categoryStr = safeToLowerCase(category);
    return categoryStr.includes("cogs");
  };

  const validateTransaction = (tx: unknown): tx is Transaction => {
    if (!tx || typeof tx !== "object") return false;
    const obj = tx as Record<string, unknown>;
    return (
      typeof obj.id === "string" &&
      typeof obj.date === "string" &&
      (typeof obj.amount === "number" || typeof obj.amount === "string") &&
      (typeof obj.name === "string" || typeof obj.description === "string") &&
      typeof obj.category === "string" &&
      !isNaN(safeParseFloat(obj.amount))
    );
  };

  const validateDeal = (deal: unknown): deal is Deal => {
    if (!deal || typeof deal !== "object") return false;
    const obj = deal as Record<string, unknown>;
    return (
      typeof obj.id === "string" &&
      typeof obj.dealName === "string" &&
      typeof obj.phase === "string" &&
      (typeof obj.amount === "number" || typeof obj.amount === "string") &&
      typeof obj.clientName === "string" &&
      !isNaN(safeParseFloat(obj.amount))
    );
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log("MetricsGrid: Starting calculation...");

        if (!user) {
          console.log("MetricsGrid: No user available yet");
          return;
        }

        const supabase = createClient();
        // Use the same service that MiltonChat uses
        const reportData = await getReportData(supabase, user.id);

        // Convert Supabase data to expected format with validation
        const transactions: Transaction[] = (reportData.transactions || [])
          .map((tx: TransactionData) => ({
            id: tx.id || `tx_${Date.now()}_${Math.random()}`,
            date: tx.date,
            amount:
              typeof tx.amount === "string"
                ? parseFloat(tx.amount)
                : tx.amount || 0,
            name: tx.name || tx.description || "",
            description: tx.description || tx.name || "",
            category: tx.category || "Uncategorized",
            reference: tx.reference || tx.id || "",
          }))
          .filter(validateTransaction);

        const crmDeals: Deal[] = (reportData.crmDeals || [])
          .map((deal: CrmDealData) => ({
            id: deal.id || `deal_${Date.now()}_${Math.random()}`,
            dealName: deal.deal_name || deal.dealName || "",
            clientName: deal.client_name || deal.clientName || "",
            amount:
              typeof deal.amount === "string"
                ? parseFloat(deal.amount)
                : deal.amount || 0,
            phase: deal.phase || deal.stage || "Unknown",
            closingDate:
              deal.closing_date || deal.close_date || deal.closingDate || "",
            firstAppointment: deal.created_date || deal.first_appointment || "",
            product: deal.product || "",
          }))
          .filter(validateDeal);

        if (transactions.length === 0) {
          setMetrics({
            mrr: 0,
            arr: 0,
            cashBalance: 0,
            burnRate: 0,
            burnRateLTM: 0,
            burnVariance: 0,
            ltmRevenue: 0,
            contractedRevenue: 0,
            grossMargin: 0,
            netMargin: 0,
            customerCount: 0,
            cac: null,
            ltv: null,
            churn: null,
            nps: null,
            runway: 0,
            quickRatio: null,
          });
          return;
        }

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

        console.log(
          `MetricsGrid: Calculating metrics for period: ${period} (${fromDate.toLocaleDateString()} to ${toDate.toLocaleDateString()})`
        );

        // Filter transactions for the selected period with safe date parsing
        const currentMonthTransactions = transactions.filter((t) => {
          try {
            const date = new Date(t.date);
            return date >= fromDate && date <= toDate && !isNaN(date.getTime());
          } catch {
            return false;
          }
        });

        console.log(
          `MetricsGrid: Found ${currentMonthTransactions.length} transactions for the month`
        );

        // If no transactions in current month, use all transactions for calculations (from stashed)
        const transactionsToUse =
          currentMonthTransactions.length > 0
            ? currentMonthTransactions
            : transactions;

        console.log(
          `MetricsGrid: Using ${transactionsToUse.length} transactions for calculations`
        );

        // Calculate MRR using recurring revenue logic
        const recurringRevenue = transactionsToUse
          .filter(
            (t) =>
              safeParseFloat(t.amount) > 0 && isRecurringRevenue(t.category)
          )
          .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

        const totalMonthlyRevenue = transactionsToUse
          .filter((t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category))
          .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

        // If no revenue found with category matching, use ALL positive transactions (from stashed)
        const allPositiveTransactions = transactionsToUse
          .filter((t) => safeParseFloat(t.amount) > 0)
          .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

        // Use recurring revenue if available, otherwise fall back to total revenue, then all positive
        const mrr =
          recurringRevenue > 0
            ? recurringRevenue
            : totalMonthlyRevenue > 0
              ? totalMonthlyRevenue
              : allPositiveTransactions;
        const arr = mrr * 12;

        // Calculate total cash balance - use ALL transactions
        const totalCash = transactions.reduce(
          (sum, t) => sum + safeParseFloat(t.amount),
          0
        );

        // Calculate monthly expenses (excluding COGS)
        const monthlyExpenses = Math.abs(
          transactionsToUse
            .filter((t) => safeParseFloat(t.amount) < 0 && !isCOGS(t.category))
            .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
        );

        // Calculate COGS separately
        const cogs = Math.abs(
          transactionsToUse
            .filter((t) => safeParseFloat(t.amount) < 0 && isCOGS(t.category))
            .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
        );

        // Calculate net burn (expenses minus revenue)
        const revenueForBurn =
          recurringRevenue > 0
            ? recurringRevenue
            : totalMonthlyRevenue > 0
              ? totalMonthlyRevenue
              : allPositiveTransactions;
        const netBurn = monthlyExpenses - revenueForBurn;

        // Calculate LTM metrics with consistent date range
        const yearAgo = new Date(toDate);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);

        const ltmTransactions = transactions.filter((t) => {
          try {
            const date = new Date(t.date);
            return date > yearAgo && date <= toDate && !isNaN(date.getTime());
          } catch {
            return false;
          }
        });

        // Calculate LTM total revenue (all revenue types)
        const ltmTotalRevenue = ltmTransactions
          .filter((t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category))
          .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

        // If no revenue found with category matching, use ALL positive transactions
        const ltmAllPositive = ltmTransactions
          .filter((t) => safeParseFloat(t.amount) > 0)
          .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

        const ltmMonthlyRevenue =
          (ltmTotalRevenue > 0 ? ltmTotalRevenue : ltmAllPositive) / 12;

        // Calculate LTM expenses and burn rate
        const ltmTotalExpenses = Math.abs(
          ltmTransactions
            .filter((t) => safeParseFloat(t.amount) < 0 && !isCOGS(t.category))
            .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
        );

        const ltmMonthlyExpenses = ltmTotalExpenses / 12;
        const ltmNetBurn = ltmMonthlyExpenses - ltmMonthlyRevenue;

        // Calculate burn variance (current vs LTM)
        const burnVariance = netBurn - ltmNetBurn;
        const burnVariancePercent =
          ltmNetBurn > 0 ? (burnVariance / ltmNetBurn) * 100 : 0;

        // Calculate contracted revenue from CRM
        const contractedRevenue = crmDeals
          .filter((d) =>
            [
              "Negotiation",
              "Deal",
              "Closed",
              "Contract",
              "Closed Won",
            ].includes(safeToString(d.phase))
          )
          .reduce((sum, d) => sum + safeParseFloat(d.amount), 0);

        // Calculate gross margin
        const revenueForMargin =
          recurringRevenue > 0
            ? recurringRevenue
            : totalMonthlyRevenue > 0
              ? totalMonthlyRevenue
              : allPositiveTransactions;
        const grossMargin =
          revenueForMargin > 0
            ? ((revenueForMargin - cogs) / revenueForMargin) * 100
            : 0;

        // Calculate net margin
        const netMargin =
          revenueForMargin > 0
            ? ((revenueForMargin - monthlyExpenses - cogs) / revenueForMargin) *
              100
            : 0;

        // Calculate unique customers with safe string handling
        const customerCount =
          crmDeals.length > 0
            ? new Set(
                crmDeals
                  .map((d) => safeToLowerCase(d.clientName).trim())
                  .filter((name) => name !== "")
              ).size
            : new Set(
                transactions
                  .filter(
                    (t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category)
                  )
                  .map((t) =>
                    safeToLowerCase(t.name || t.description || "").trim()
                  )
                  .filter((name) => name !== "")
              ).size;

        // Calculate runway
        const monthlyBurnRate = Math.max(0, netBurn); // Ensure positive burn rate
        const runway =
          monthlyBurnRate > 0 && totalCash > 0
            ? Math.round(totalCash / monthlyBurnRate)
            : ltmMonthlyExpenses > 0
              ? Math.round(totalCash / ltmMonthlyExpenses)
              : 0;

        console.log("MetricsGrid: Calculated metrics:", {
          mrr,
          arr,
          totalMonthlyRevenue,
          recurringRevenue,
          allPositiveTransactions,
          monthlyExpenses,
          netBurn,
          ltmMonthlyRevenue,
          ltmNetBurn,
          totalCash,
          contractedRevenue,
          customerCount,
          currentMonthCount: currentMonthTransactions.length,
          totalTransactionsCount: transactions.length,
          transactionsToUseCount: transactionsToUse.length,
        });

        setMetrics({
          mrr: Math.round(mrr),
          arr: Math.round(arr),
          cashBalance: Math.round(totalCash),
          burnRate: Math.round(Math.max(0, netBurn)),
          burnRateLTM: Math.round(Math.max(0, ltmNetBurn)),
          burnVariance: Math.round(burnVariancePercent),
          ltmRevenue: Math.round(ltmMonthlyRevenue),
          contractedRevenue: Math.round(contractedRevenue),
          grossMargin: Math.round(grossMargin),
          netMargin: Math.round(netMargin),
          customerCount: customerCount,
          cac: null,
          ltv: null,
          churn: null,
          nps: null,
          runway: runway,
          quickRatio: null,
        });
      } catch (error) {
        console.error("MetricsGrid: Error calculating metrics:", error);
        // Set safe default values on any error
        setMetrics({
          mrr: 0,
          arr: 0,
          cashBalance: 0,
          burnRate: 0,
          burnRateLTM: 0,
          burnVariance: 0,
          ltmRevenue: 0,
          contractedRevenue: 0,
          grossMargin: 0,
          netMargin: 0,
          customerCount: 0,
          cac: null,
          ltv: null,
          churn: null,
          nps: null,
          runway: 0,
          quickRatio: null,
        });
      }
    };
    fetchData();
  }, [period, customDateRange, user]);

  const formatCurrency = (value: number | null) => {
    if (value === null) return "N/A";
    const absValue = Math.abs(value);
    const currencySymbol =
      prefs.currency === "EUR"
        ? "€"
        : prefs.currency === "USD"
          ? "$"
          : prefs.currency === "GBP"
            ? "£"
            : "CHF";

    if (absValue >= 1000000) {
      return `${currencySymbol}${(value / 1000000).toFixed(1)}M`;
    } else if (absValue >= 1000) {
      return `${currencySymbol}${(value / 1000).toFixed(1)}k`;
    }
    return formatCurrencyUtil(value, prefs.currency, prefs.number_format);
  };

  const formatMetricValue = (metric: MetricCard) => {
    if (metric.format === "currency") {
      return metric.value !== null ? formatCurrency(metric.value) : "N/A";
    } else if (metric.format === "percentage") {
      return metric.value !== null
        ? formatPercentage(metric.value / 100)
        : "N/A";
    } else if (metric.format === "number") {
      return metric.value !== null
        ? formatNumber(metric.value, prefs.number_format)
        : "N/A";
    } else if (metric.format === "months") {
      return metric.value !== null
        ? metric.value > 100
          ? "∞"
          : `${metric.value} months`
        : "N/A";
    }
    return metric.value?.toString() || "N/A";
  };

  const allMetricCards: MetricCard[] = [
    {
      id: "mrr",
      title: "MRR",
      value: metrics.mrr,
      format: "currency",
      description: "Monthly Recurring Revenue",
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      id: "arr",
      title: "ARR",
      value: metrics.arr,
      format: "currency",
      description: "Annual Recurring Revenue",
      icon: TrendingUp,
      color: "text-blue-600",
    },
    {
      id: "cashBalance",
      title: "Cash Balance",
      value: metrics.cashBalance,
      format: "currency",
      description: "Total cash on hand",
      icon: CreditCard,
      color: metrics.cashBalance >= 0 ? "text-green-600" : "text-red-600",
    },
    {
      id: "burnRate",
      title: "Net Burn",
      value: metrics.burnRate,
      format: "currency",
      suffix: "/mo",
      description: "Monthly net cash burn",
      icon: Activity,
      color: metrics.burnRate > 0 ? "text-red-600" : "text-green-600",
    },
    {
      id: "contracted",
      title: "Contracted",
      value: metrics.contractedRevenue,
      format: "currency",
      description: "Pipeline in negotiation/closed",
      icon: Target,
      color: "text-purple-600",
    },
    {
      id: "burnVariance",
      title: "Burn vs LTM",
      value: metrics.burnVariance,
      format: "percentage",
      description: "Current burn vs LTM average",
      icon: TrendingUp,
      color:
        metrics.burnVariance < -5
          ? "text-green-600"
          : metrics.burnVariance > 5
            ? "text-red-600"
            : "text-yellow-600",
    },
    {
      id: "burnRateLTM",
      title: "LTM Avg Burn",
      value: metrics.burnRateLTM,
      format: "currency",
      suffix: "/mo",
      description: "Last 12 months avg monthly burn",
      icon: Activity,
      color: metrics.burnRateLTM > 0 ? "text-orange-600" : "text-green-600",
    },
    {
      id: "ltmRevenue",
      title: "LTM Avg Revenue",
      value: metrics.ltmRevenue,
      format: "currency",
      description: "Last 12 months avg monthly revenue",
      icon: Wallet,
      color: "text-indigo-600",
    },
    {
      id: "grossMargin",
      title: "Gross Margin",
      value: metrics.grossMargin,
      format: "percentage",
      description: "Revenue after COGS",
      icon: Percent,
      color:
        metrics.grossMargin > 70
          ? "text-green-600"
          : metrics.grossMargin > 50
            ? "text-yellow-600"
            : "text-red-600",
    },
    {
      id: "netMargin",
      title: "Net Margin",
      value: metrics.netMargin,
      format: "percentage",
      description: "Income as % of sales",
      icon: Percent,
      color:
        metrics.netMargin > 20
          ? "text-green-600"
          : metrics.netMargin > 0
            ? "text-yellow-600"
            : "text-red-600",
    },
    {
      id: "customers",
      title: "Customers",
      value: metrics.customerCount,
      format: "number",
      description: "Active customer count",
      icon: Users,
      color: "text-blue-600",
    },
    {
      id: "cac",
      title: "CAC",
      value: metrics.cac,
      format: "currency",
      description: "Customer Acquisition Cost",
      icon: Target,
      color: "text-orange-600",
    },
    {
      id: "ltv",
      title: "LTV",
      value: metrics.ltv,
      format: "currency",
      description: "Customer Lifetime Value",
      icon: Users,
      color: "text-cyan-600",
    },
    {
      id: "churn",
      title: "Churn Rate",
      value: metrics.churn,
      format: "percentage",
      description: "Monthly customer churn %",
      icon: TrendingUp,
      color:
        metrics.churn !== null && metrics.churn > 5
          ? "text-red-600"
          : "text-green-600",
    },
    {
      id: "nps",
      title: "NPS",
      value: metrics.nps,
      format: "number",
      description: "Net Promoter Score",
      icon: Users,
      color:
        metrics.nps !== null && metrics.nps > 50
          ? "text-green-600"
          : metrics.nps !== null && metrics.nps > 0
            ? "text-yellow-600"
            : "text-red-600",
    },
    {
      id: "runway",
      title: "Runway",
      value: metrics.runway,
      format: "months",
      description: "Months of cash runway",
      icon: Calendar,
      color:
        metrics.runway > 12
          ? "text-green-600"
          : metrics.runway > 6
            ? "text-yellow-600"
            : "text-red-600",
    },
    {
      id: "quickRatio",
      title: "Quick Ratio",
      value: metrics.quickRatio,
      format: "number",
      description: "Growth efficiency metric",
      icon: Zap,
      color:
        metrics.quickRatio !== null && metrics.quickRatio > 1
          ? "text-green-600"
          : "text-red-600",
    },
    // --- Fitness Studio KPIs ---
    {
      id: "class_utilization",
      title: "Class Utilization Rate",
      value: null,
      format: "percentage",
      description: "Percentage of available spots filled per class",
      icon: Users,
      color: "text-blue-600",
    },
    {
      id: "avg_attendance_per_class",
      title: "Average Attendance per Class",
      value: null,
      format: "number",
      description: "Average number of attendees per class session",
      icon: Users,
      color: "text-green-600",
    },
    {
      id: "pack_membership_sales",
      title: "Pack & Membership Sales",
      value: null,
      format: "currency",
      description: "Revenue from class packs and memberships",
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      id: "cancellation_rate",
      title: "Late Cancellation / No-Show Rate",
      value: null,
      format: "percentage",
      description: "Share of bookings cancelled late or not attended",
      icon: Activity,
      color: "text-red-600",
    },
    {
      id: "instructor_margin",
      title: "Instructor Margin",
      value: null,
      format: "percentage",
      description: "Revenue generated by instructor minus their cost",
      icon: Percent,
      color: "text-blue-600",
    },
  ];

  // Filter metrics based on selection
  const metricCards = allMetricCards.filter((metric) =>
    selectedMetrics.includes(metric.id)
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <Icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${metric.color}`}>
                {formatMetricValue(metric)}
                {metric.suffix || ""}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
