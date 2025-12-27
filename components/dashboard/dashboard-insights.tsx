"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Lightbulb,
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Info,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getReportData } from "@/lib/report-data-service";
import { useBusinessContext } from "@/lib/business-context";

interface Insight {
  title: string;
  description: string;
  category: "positive" | "warning" | "info" | "action";
}

export function DashboardInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { businessType } = useBusinessContext();

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      // Fetch report data to get KPIs
      const reportData = await getReportData(supabase, user.id);

      // Calculate metrics similar to MetricsGrid
      const transactions = reportData.transactions || [];
      const crmDeals = reportData.crmDeals || [];

      // Calculate key metrics
      const now = new Date();
      const latestTransaction = transactions
        .map((t) => {
          try {
            return new Date(t.date);
          } catch {
            return new Date();
          }
        })
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const targetMonth = latestTransaction || now;
      const monthStart = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        1
      );
      const monthEnd = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
        23,
        59,
        59
      );

      const currentMonthTransactions = transactions.filter((t) => {
        try {
          const date = new Date(t.date);
          return (
            date >= monthStart && date <= monthEnd && !isNaN(date.getTime())
          );
        } catch {
          return false;
        }
      });

      const transactionsToUse =
        currentMonthTransactions.length > 0
          ? currentMonthTransactions
          : transactions;

      // Calculate metrics
      const isRevenue = (category: string) => {
        const cat = category?.toLowerCase() || "";
        return [
          "subscription",
          "consulting",
          "service",
          "sales",
          "revenue",
        ].some((r) => cat.includes(r));
      };

      const isRecurringRevenue = (category: string) => {
        const cat = category?.toLowerCase() || "";
        return ["subscription", "monthly", "recurring", "mrr"].some((r) =>
          cat.includes(r)
        );
      };

      const recurringRevenue = transactionsToUse
        .filter(
          (t) =>
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0) > 0 && isRecurringRevenue(t.category || "")
        )
        .reduce(
          (sum, t) =>
            sum +
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0),
          0
        );

      const totalMonthlyRevenue = transactionsToUse
        .filter(
          (t) =>
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0) > 0 && isRevenue(t.category || "")
        )
        .reduce(
          (sum, t) =>
            sum +
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0),
          0
        );

      const allPositiveTransactions = transactionsToUse
        .filter(
          (t) =>
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0) > 0
        )
        .reduce(
          (sum, t) =>
            sum +
            (typeof t.amount === "string"
              ? parseFloat(t.amount)
              : t.amount || 0),
          0
        );

      const mrr =
        recurringRevenue > 0
          ? recurringRevenue
          : totalMonthlyRevenue > 0
            ? totalMonthlyRevenue
            : allPositiveTransactions;

      const monthlyExpenses = Math.abs(
        transactionsToUse
          .filter(
            (t) =>
              (typeof t.amount === "string"
                ? parseFloat(t.amount)
                : t.amount || 0) < 0
          )
          .reduce(
            (sum, t) =>
              sum +
              (typeof t.amount === "string"
                ? parseFloat(t.amount)
                : t.amount || 0),
            0
          )
      );

      const totalCash = transactions.reduce(
        (sum, t) =>
          sum +
          (typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0),
        0
      );

      const netBurn = monthlyExpenses - mrr;
      const runway =
        netBurn > 0 && totalCash > 0 ? Math.round(totalCash / netBurn) : 0;

      const contractedRevenue = crmDeals
        .filter((d) =>
          ["Negotiation", "Deal", "Closed", "Contract", "Closed Won"].includes(
            d.phase || ""
          )
        )
        .reduce(
          (sum, d) =>
            sum +
            (typeof d.amount === "string"
              ? parseFloat(d.amount)
              : d.amount || 0),
          0
        );

      // Prepare metrics for AI
      const metrics = {
        mrr: Math.round(mrr),
        arr: Math.round(mrr * 12),
        cashBalance: Math.round(totalCash),
        burnRate: Math.round(Math.max(0, netBurn)),
        runway: runway,
        contractedRevenue: Math.round(contractedRevenue),
        openDeals: crmDeals.filter((d) => d.phase !== "Closed Won").length,
        totalDeals: crmDeals.length,
        revenue: reportData.kpis.revenue || 0,
        expenses: reportData.kpis.expenses || 0,
        netIncome: reportData.kpis.netIncome || 0,
        pipelineValue: reportData.kpis.pipelineValue || 0,
      };

      // Only generate insights if we have meaningful data
      const hasData =
        metrics.mrr > 0 ||
        metrics.cashBalance !== 0 ||
        metrics.burnRate > 0 ||
        metrics.revenue > 0 ||
        metrics.expenses > 0;

      if (!hasData) {
        setInsights([
          {
            title: "Upload Data to Get Insights",
            description:
              "Start uploading your financial data (transactions, CRM deals, or budgets) to receive AI-powered insights and recommendations.",
            category: "info",
          },
        ]);
        setLoading(false);
        return;
      }

      // Call AI API to generate insights
      const response = await fetch("/api/ai/insight-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metrics,
          businessType: businessType || reportData.businessType,
          kpis: reportData.kpis,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to generate insights (${response.status})`
        );
      }

      const data = await response.json();
      setInsights(data.insights || []);
    } catch (err) {
      console.error("Error fetching insights:", err);
      setError(err instanceof Error ? err.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const getCategoryStyles = (category: Insight["category"]) => {
    switch (category) {
      case "positive":
        return {
          gradient: "from-emerald-500/10 via-green-500/5 to-teal-500/10",
          border: "border-emerald-500/20",
          icon: CheckCircle2,
          iconColor: "text-emerald-500",
          badge:
            "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
        };
      case "warning":
        return {
          gradient: "from-amber-500/10 via-yellow-500/5 to-orange-500/10",
          border: "border-amber-500/20",
          icon: AlertTriangle,
          iconColor: "text-amber-500",
          badge:
            "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
        };
      case "action":
        return {
          gradient: "from-blue-500/10 via-indigo-500/5 to-purple-500/10",
          border: "border-blue-500/20",
          icon: Sparkles,
          iconColor: "text-blue-500",
          badge:
            "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
        };
      default:
        return {
          gradient: "from-slate-500/10 via-gray-500/5 to-zinc-500/10",
          border: "border-slate-500/20",
          icon: Info,
          iconColor: "text-slate-500",
          badge:
            "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400",
        };
    }
  };

  const getCategoryLabel = (category: Insight["category"]) => {
    switch (category) {
      case "positive":
        return "Positive";
      case "warning":
        return "Warning";
      case "action":
        return "Action";
      default:
        return "Info";
    }
  };

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-0">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground font-medium">
                Generating insights...
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-0">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground mb-4 font-medium">
              {error}
            </p>
            <Button
              onClick={fetchInsights}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (insights.length === 0) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-0">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <Info className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground font-medium">
              No insights available. Upload financial data to get AI-powered
              insights.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-transparent pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 backdrop-blur-sm">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI Insights
            </span>
          </CardTitle>
          <Button
            onClick={fetchInsights}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-primary/10 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {insights.map((insight, index) => {
            const styles = getCategoryStyles(insight.category);
            const Icon = styles.icon;
            return (
              <div
                key={index}
                className={`group relative overflow-hidden rounded-xl border ${styles.border} bg-gradient-to-br ${styles.gradient} p-5 transition-all duration-300 hover:shadow-lg hover:scale-[1.01] hover:border-opacity-40`}
                style={{
                  animation: `fadeInUp 0.4s ease-out ${index * 0.08}s both`,
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex-shrink-0 p-2.5 rounded-lg bg-background/50 backdrop-blur-sm border ${styles.border} group-hover:scale-110 transition-transform duration-300`}
                  >
                    <Icon className={`h-5 w-5 ${styles.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="font-semibold text-base text-foreground leading-tight">
                        {insight.title}
                      </h4>
                      <Badge
                        variant="outline"
                        className={`${styles.badge} text-xs font-medium shrink-0`}
                      >
                        {getCategoryLabel(insight.category)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {insight.description}
                    </p>
                  </div>
                </div>
                {/* Decorative accent line */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${styles.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
