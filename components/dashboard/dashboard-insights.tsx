"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Lightbulb,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Info,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { getReportData } from "@/lib/report-data-service";
import { useBusinessContext } from "@/lib/business-context";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { useUser } from "@/lib/context/UserContext";

interface Insight {
  id?: string;
  title: string;
  description: string;
  category: "positive" | "warning" | "info" | "action";
}

export function DashboardInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(
    new Set()
  );
  const [removedInsights, setRemovedInsights] = useState<Set<string>>(
    new Set()
  );
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [isCardCollapsed, setIsCardCollapsed] = useState(true);
  const { businessType } = useBusinessContext();
  const { prefs } = useUserPreferences();
  const { user } = useUser();

  // Get current analytics KPIs that are displayed on dashboard
  const getCurrentAnalyticsKpis = async () => {
    try {
      if (!user) return null;

      // Get business model
      const supabase = createClient();
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .single();

      if (!company) return null;

      const { data: businessModelData } = await supabase
        .from("business_models")
        .select("business_type")
        .eq("company_id", company.id)
        .single();

      const businessModel = businessModelData?.business_type;
      if (!businessModel) return null;

      // Calculate date range (similar to dashboard page)
      const fromDate = new Date(new Date().setMonth(new Date().getMonth() - 1))
        .toISOString()
        .split("T")[0];
      const toDate = new Date().toISOString().split("T")[0];

      let analyticsUrl = "";
      if (businessModel === "fitness_studio") {
        analyticsUrl = `/api/analytics/fitness-studio/kpis?from_date=${fromDate}&to_date=${toDate}`;
      } else if (businessModel === "restaurant") {
        analyticsUrl = `/api/analytics/restaurant/kpis?from_date=${fromDate}&to_date=${toDate}`;
      }

      if (analyticsUrl) {
        const response = await fetch(analyticsUrl, {
          cache: "no-store",
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          return data.kpis || data;
        }
      }

      return null;
    } catch (err) {
      console.error("[getCurrentAnalyticsKpis] Error:", err);
      return null;
    }
  };

  // Load insights from database
  const loadInsightsFromDB = async () => {
    try {
      if (!user) {
        return [];
      }

      const supabase = createClient();
      const { data, error } = await supabase
        .from("dashboard_insights")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading insights:", error);
        return [];
      }

      return (data || []).map((insight: any) => ({
        id: insight.id,
        title: insight.title,
        description: insight.description,
        category: insight.category as Insight["category"],
      }));
    } catch (err) {
      console.error("Error loading insights from DB:", err);
      return [];
    }
  };

  // Save insights to database
  const saveInsightsToDB = async (
    insightsToSave: Insight[],
    replaceAll: boolean = true
  ) => {
    try {
      if (!user) {
        return;
      }

      const supabase = createClient();

      if (replaceAll) {
        // Delete all existing insights for this user
        await supabase
          .from("dashboard_insights")
          .delete()
          .eq("user_id", user.id);
      }

      // Insert new insights
      if (insightsToSave.length > 0) {
        const insightsToInsert = insightsToSave.map((insight) => ({
          user_id: user.id,
          title: insight.title,
          description: insight.description,
          category: insight.category,
        }));

        const { error } = await supabase
          .from("dashboard_insights")
          .insert(insightsToInsert);

        if (error) {
          console.error("Error saving insights:", error);
        }
      }
    } catch (err) {
      console.error("Error saving insights to DB:", err);
    }
  };

  // Delete insight from database
  const deleteInsightFromDB = async (insightId: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("dashboard_insights")
        .delete()
        .eq("id", insightId);

      if (error) {
        console.error("Error deleting insight:", error);
      }
    } catch (err) {
      console.error("Error deleting insight from DB:", err);
    }
  };

  const generateNewInsights = async (count?: number) => {
    setLoading(true);
    setError(null);

    try {
      if (!user) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // Get analytics KPIs that are displayed on the dashboard
      // These are the KPIs that users see and interact with
      const analyticsKpis = await getCurrentAnalyticsKpis();

      if (!analyticsKpis) {
        setError("Unable to fetch analytics data for insights generation");
        setLoading(false);
        return;
      }

      // Fetch report data to get additional KPIs
      const reportData = await getReportData(supabase, user.id);

      const isRestaurant =
        (businessType || reportData.businessType) === "restaurant";

      // Prepare metrics for AI: fitness-studio keys + restaurant keys so both work
      const metrics = {
        activeMembers: analyticsKpis.activeMembers || 0,
        newMembers: analyticsKpis.newMembers || 0,
        churnRate: analyticsKpis.churnRate || 0,
        utilizationRate: analyticsKpis.utilizationRate || 0,
        revenuePerMember: analyticsKpis.revenuePerMember || 0,
        totalRevenue:
          analyticsKpis.totalRevenue ?? reportData.kpis.revenue ?? 0,
        totalCosts: analyticsKpis.totalCosts ?? reportData.kpis.expenses ?? 0,
        netIncome: analyticsKpis.netIncome ?? reportData.kpis.netIncome ?? 0,
        burnRate: analyticsKpis.burnRate ?? reportData.kpis.burnRate ?? 0,
        cashBalance: reportData.kpis.cashRunway
          ? reportData.kpis.cashRunway *
            (analyticsKpis.burnRate ?? reportData.kpis.burnRate ?? 0)
          : 0,
        runway: reportData.kpis.cashRunway || 0,
        contractedRevenue: reportData.kpis.pipelineValue || 0,
        pipelineValue: reportData.kpis.pipelineValue || 0,
        // Restaurant-specific (so AI and hasData can use them)
        covers: analyticsKpis.covers ?? 0,
        averageTicketSize:
          analyticsKpis.averageTicketSize ??
          analyticsKpis.averageOrderValue ??
          0,
        averageOrderValue:
          analyticsKpis.averageOrderValue ??
          analyticsKpis.averageTicketSize ??
          0,
        primeCostPercent: analyticsKpis.primeCostPercent ?? 0,
        netCashFlow:
          analyticsKpis.netCashFlow ?? reportData.kpis.netIncome ?? 0,
      };

      // Only generate insights if we have meaningful data (fitness + restaurant)
      const hasData =
        metrics.activeMembers > 0 ||
        metrics.newMembers > 0 ||
        metrics.totalRevenue > 0 ||
        metrics.totalCosts > 0 ||
        metrics.netIncome !== 0 ||
        metrics.burnRate > 0 ||
        metrics.churnRate > 0 ||
        metrics.utilizationRate > 0 ||
        (isRestaurant &&
          (metrics.covers > 0 ||
            metrics.averageOrderValue > 0 ||
            metrics.primeCostPercent > 0 ||
            metrics.netCashFlow !== 0));

      if (!hasData) {
        setInsights([
          {
            id: "no-data-placeholder",
            title: "No Data Available for Insights",
            description:
              "Your analytics data doesn't contain meaningful metrics yet. Try uploading more data or checking your data sources.",
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
          currency: prefs.currency || "EUR",
          numberFormat: prefs.number_format || "1,000.00",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to generate insights (${response.status})`
        );
      }

      const data = await response.json();
      const allGeneratedInsights = data.insights || [];
      const maxInsights = 5;
      const newInsights = count
        ? allGeneratedInsights.slice(0, Math.min(count, maxInsights))
        : allGeneratedInsights.slice(0, maxInsights);

      // Save to database (replaceAll = !count means if count is provided, it's a partial refresh)
      await saveInsightsToDB(newInsights, !count);

      // Reload from database to get IDs
      const savedInsights = await loadInsightsFromDB();
      setInsights(savedInsights);

      // Reset expanded states but keep removed insights
      setExpandedInsights(new Set());
    } catch (err) {
      console.error("Error generating insights:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate insights"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshClick = () => {
    const removedCount = removedInsights.size;
    if (removedCount > 0) {
      setShowRefreshDialog(true);
    } else {
      generateNewInsights();
    }
  };

  const handleRefreshAll = async () => {
    setRemovedInsights(new Set());
    setShowRefreshDialog(false);
    await generateNewInsights();
  };

  const handleRefreshMissing = async () => {
    const removedCount = removedInsights.size;
    const currentRemovedIds = new Set(removedInsights);
    setRemovedInsights(new Set());
    setShowRefreshDialog(false);

    // Generate only the missing count
    await generateNewInsights(removedCount);

    // After generating, remove the old removed insights from the array
    setInsights((prev) =>
      prev.filter((insight) => !currentRemovedIds.has(insight.id || ""))
    );
  };

  useEffect(() => {
    const loadInsights = async () => {
      setLoading(true);
      const savedInsights = await loadInsightsFromDB();

      if (savedInsights.length > 0) {
        // Limit to max insights to respect the current limit
        const maxInsights = 5;
        const limitedInsights = savedInsights.slice(0, maxInsights);
        setInsights(limitedInsights);
        setLoading(false);
      } else {
        // No insights in DB, generate new ones
        await generateNewInsights();
      }
    };

    loadInsights();
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

  const toggleInsight = (insightId: string) => {
    setExpandedInsights((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(insightId)) {
        newSet.delete(insightId);
      } else {
        newSet.add(insightId);
      }
      return newSet;
    });
  };

  const removeInsight = async (insightId: string) => {
    // Remove from database
    await deleteInsightFromDB(insightId);

    // Update local state to mark as removed (but keep in array for refresh logic)
    setRemovedInsights((prev) => {
      const newSet = new Set(prev);
      newSet.add(insightId);
      return newSet;
    });
  };

  // Filter out removed insights
  const visibleInsights = insights.filter(
    (insight) => insight.id && !removedInsights.has(insight.id)
  );

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-3">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-tight">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        {!isCardCollapsed && (
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
        )}
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-3">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-tight">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        {!isCardCollapsed && (
          <CardContent>
            <div className="py-8 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground mb-4 font-medium">
                {error}
              </p>
              <Button
                onClick={handleRefreshClick}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  if (insights.length === 0) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-transparent pb-3">
          <CardTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-tight">
              AI Insights
            </span>
          </CardTitle>
        </CardHeader>
        {!isCardCollapsed && (
          <CardContent>
            <div className="py-8 text-center">
              <Info className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground font-medium">
                No insights available. Upload financial data to get AI-powered
                insights.
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-transparent pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CardTitle className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-primary/10 backdrop-blur-sm">
                <Lightbulb className="h-5 w-5 text-primary" />
              </div>
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-tight">
                AI Insights
              </span>
              {isCardCollapsed && visibleInsights.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 px-1.5 text-xs font-medium"
                >
                  {visibleInsights.length}
                </Badge>
              )}
            </CardTitle>
            <button
              onClick={() => setIsCardCollapsed(!isCardCollapsed)}
              className="ml-2 flex items-center justify-center h-7 w-7 rounded hover:bg-primary/10 transition-colors"
              aria-label={isCardCollapsed ? "Expand" : "Collapse"}
            >
              {isCardCollapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground transition-colors" />
              )}
            </button>
          </div>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleRefreshClick();
            }}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-primary/10 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      {!isCardCollapsed && (
        <CardContent className="pt-0">
          {visibleInsights.length === 0 ? (
            <div className="py-8 text-center">
              <Info className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground font-medium">
                All insights have been removed. Click refresh to generate new
                ones.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visibleInsights.map((insight, displayIndex) => {
                if (!insight.id) return null;

                const styles = getCategoryStyles(insight.category);
                const Icon = styles.icon;
                const isExpanded = expandedInsights.has(insight.id);

                return (
                  <div
                    key={insight.id}
                    className={`group relative overflow-hidden rounded-xl border ${styles.border} bg-gradient-to-br ${styles.gradient} transition-all duration-300 hover:shadow-lg hover:scale-[1.01] hover:border-opacity-40 ${
                      isExpanded ? "" : ""
                    }`}
                    style={{
                      animation: `fadeInUp 0.4s ease-out ${displayIndex * 0.08}s both`,
                    }}
                  >
                    <div
                      className={`transition-all duration-300 ${isExpanded ? "p-5" : "py-3 px-4"}`}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex-shrink-0 rounded-lg bg-background/50 backdrop-blur-sm border ${styles.border} group-hover:scale-110 transition-transform duration-300 ${
                            isExpanded ? "p-2.5" : "p-2"
                          }`}
                        >
                          <Icon
                            className={`${isExpanded ? "h-5 w-5" : "h-4 w-4"} ${styles.iconColor}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              onClick={() => toggleInsight(insight.id!)}
                              className="flex-1 text-left group/button"
                            >
                              <h4
                                className={`font-semibold text-foreground leading-tight group-hover/button:text-primary transition-colors ${
                                  isExpanded ? "text-base" : "text-sm"
                                }`}
                              >
                                {insight.title}
                              </h4>
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge
                                variant="outline"
                                className={`${styles.badge} text-xs font-medium`}
                              >
                                {getCategoryLabel(insight.category)}
                              </Badge>
                              <Button
                                onClick={() => toggleInsight(insight.id!)}
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 hover:bg-primary/10 transition-colors"
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                onClick={() => removeInsight(insight.id!)}
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive transition-colors"
                                aria-label="Remove insight"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div
                            className={`overflow-hidden transition-all duration-300 ease-in-out ${
                              isExpanded
                                ? "max-h-[500px] opacity-100 mt-3"
                                : "max-h-0 opacity-0 mt-0"
                            }`}
                          >
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {insight.description}
                            </p>
                          </div>
                        </div>
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
          )}
        </CardContent>
      )}

      <Dialog open={showRefreshDialog} onOpenChange={setShowRefreshDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refresh Insights</DialogTitle>
            <DialogDescription>
              You have removed {removedInsights.size} insight
              {removedInsights.size !== 1 ? "s" : ""}. Would you like to
              generate all new insights or only replace the removed ones?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowRefreshDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="outline" onClick={handleRefreshMissing}>
              Replace {removedInsights.size} Missing
            </Button>
            <Button onClick={handleRefreshAll}>Generate All New</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
