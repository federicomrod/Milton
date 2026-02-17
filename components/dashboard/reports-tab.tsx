// components/dashboard/reports-tab.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { generateReportSlides } from "@/lib/pdf-generator-slides";
import { getReportData } from "@/lib/report-data-service";
import { generateInsights } from "@/lib/ai/insights";
import { generateChartImages } from "@/lib/chart-generator";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { useReportData } from "@/lib/hooks/useReportData";
import {
  DEFAULT_REPORT_CONFIG,
  DEFAULT_FITNESS_STUDIO_CONFIG,
  type ReportConfig,
} from "@/lib/types/report";
import {
  parsePeriodLabel,
  generateMonthOptions,
} from "@/lib/utils/report-utils";
import { DataAvailabilityAlert } from "./reports/DataAvailabilityAlert";
import { ReportPreview } from "./reports/ReportPreview";
import { ReportSection } from "./reports/ReportSection";
import { MonthYearPicker } from "./reports/MonthYearPicker";

export function ReportsTab() {
  const { prefs } = useUserPreferences();
  const { isClient, dataStatus } = useReportData();
  const [businessModel, setBusinessModel] = useState<string | null>(null);
  const [loadingBusinessModel, setLoadingBusinessModel] = useState(true);
  const [config, setConfig] = useState<ReportConfig>(DEFAULT_REPORT_CONFIG);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "generating" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    stepName: string;
  } | null>(null);

  // Fetch business model on mount
  useEffect(() => {
    const fetchBusinessModel = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setLoadingBusinessModel(false);
          return;
        }

        const { data: company, error: companyError } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (companyError) {
          console.warn("[ReportsTab] Company not found:", companyError);
          setLoadingBusinessModel(false);
          return;
        }

        if (company) {
          const { data: businessModelData, error: businessModelError } =
            await supabase
              .from("business_models")
              .select("business_type")
              .eq("company_id", company.id)
              .single();

          // Handle case where business_models row doesn't exist yet
          if (businessModelError) {
            if (businessModelError.code === "PGRST116") {
              // No rows found - business model not set yet
              console.log(
                "[ReportsTab] No business model found for company, using default"
              );
            } else {
              console.warn(
                "[ReportsTab] Error fetching business model:",
                businessModelError
              );
            }
            return;
          }

          if (businessModelData?.business_type) {
            const model = businessModelData.business_type as string;
            setBusinessModel(model);
            // Initialize config based on business model
            // Handle both "fitness_studio" and "Fitness Studio" formats
            const normalizedModel = model.toLowerCase().replace(/\s+/g, "_");
            if (normalizedModel === "fitness_studio") {
              setConfig({
                ...DEFAULT_FITNESS_STUDIO_CONFIG,
                businessModel: model,
              });
            }
          }
        }
      } catch (err) {
        console.error("Error fetching business model:", err);
      } finally {
        setLoadingBusinessModel(false);
      }
    };

    fetchBusinessModel();
  }, []);

  const handleConfigChange = (field: keyof ReportConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleSection = (sectionId: string, enabled: boolean) => {
    setConfig((prev) => {
      const section = prev[sectionId as keyof ReportConfig];
      if (section && typeof section === "object" && "enabled" in section) {
        return {
          ...prev,
          [sectionId]: { ...section, enabled },
        };
      }
      return prev;
    });
  };

  const handleToggleCard = (
    sectionId: string,
    cardId: string,
    enabled: boolean
  ) => {
    setConfig((prev) => {
      const section = prev[sectionId as keyof ReportConfig];
      if (section && typeof section === "object" && "cards" in section) {
        return {
          ...prev,
          [sectionId]: {
            ...section,
            cards: {
              ...(section.cards as Record<string, boolean>),
              [cardId]: enabled,
            },
          },
        };
      }
      return prev;
    });
  };

  const handleToggleChart = (
    sectionId: string,
    chartId: string,
    enabled: boolean
  ) => {
    setConfig((prev) => {
      const section = prev[sectionId as keyof ReportConfig];
      if (section && typeof section === "object" && "charts" in section) {
        return {
          ...prev,
          [sectionId]: {
            ...section,
            charts: {
              ...(section.charts as Record<string, boolean>),
              [chartId]: enabled,
            },
          },
        };
      }
      return prev;
    });
  };

  const generatePDF = async () => {
    if (!isClient) {
      setError("PDF generator not available. Please refresh the page.");
      setGenerationStatus("error");
      return;
    }

    setIsGenerating(true);
    setGenerationStatus("generating");
    setError(null);

    // Determine total steps based on report type
    const isFitnessStudio =
      businessModel &&
      businessModel.toLowerCase().replace(/\s+/g, "_") === "fitness_studio";
    const totalSteps = isFitnessStudio ? 4 : 5; // Fitness studio: data, KPIs, charts, PDF | SaaS: data, KPIs, insights, charts, PDF

    try {
      // Step 1: Fetching report data
      setGenerationProgress({
        currentStep: 1,
        totalSteps,
        stepName: "Fetching report data...",
      });

      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("No authenticated user found. Please log in.");
      }

      const periodRange = parsePeriodLabel(config.reportPeriod);

      // Determine date range for fitness studio data
      // For monthly reports, use the full month range
      let fromDate: string;
      let toDate: string;

      if (periodRange) {
        fromDate = periodRange.start;
        toDate = periodRange.end;
      } else {
        // Fallback: last month
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        fromDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1)
          .toISOString()
          .split("T")[0];
        toDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)
          .toISOString()
          .split("T")[0];
      }

      console.log("[ReportsTab] Date range for report:", {
        fromDate,
        toDate,
        reportPeriod: config.reportPeriod,
      });

      // Fetch report data from Supabase with period filter
      const reportData = await getReportData(
        supabase,
        user.id,
        periodRange || undefined
      );

      // Step 2: Fetching fitness studio KPIs (if applicable)
      let fitnessStudioData: any = null;
      if (isFitnessStudio) {
        setGenerationProgress({
          currentStep: 2,
          totalSteps,
          stepName: "Fetching fitness studio KPIs...",
        });

        try {
          const { fetchFitnessStudioKpis } =
            await import("@/lib/fitness-studio-report-data");

          console.log("[ReportsTab] Fetching fitness studio KPIs for:", {
            fromDate,
            toDate,
            reportPeriod: config.reportPeriod,
          });
          const fitnessKpis = await fetchFitnessStudioKpis(fromDate, toDate);
          console.log("[ReportsTab] Fetched fitness KPIs:", {
            ...fitnessKpis,
            keys: Object.keys(fitnessKpis),
            hasData: Object.keys(fitnessKpis).length > 0,
            sampleValues: Object.entries(fitnessKpis)
              .slice(0, 5)
              .map(([k, v]) => ({ [k]: v })),
          });

          // Check if we have any meaningful data (at least one non-null, non-undefined value)
          const hasKpiData =
            Object.keys(fitnessKpis).length > 0 &&
            Object.values(fitnessKpis).some(
              (v) => v !== null && v !== undefined
            );

          if (!hasKpiData) {
            console.warn(
              `[ReportsTab] No fitness studio data found for period ${config.reportPeriod} (${fromDate} to ${toDate}). Please select a month with data.`
            );
            setError(
              `No data found for ${config.reportPeriod}. Please select a month that contains your fitness studio data. Based on your data, try selecting October, November, or December 2024.`
            );
            setGenerationStatus("error");
            setIsGenerating(false);
            setGenerationProgress(null);
            return;
          }

          // Financial KPIs should already be included from the fitness studio KPIs API
          // Only merge if they're missing (fallback to reportData for non-fitness-studio calculations)
          const mergedKpis = {
            ...fitnessKpis,
            // Use fitness studio KPIs first, fallback to reportData only if not available
            totalRevenue: fitnessKpis.totalRevenue ?? reportData.kpis.revenue,
            totalCosts: fitnessKpis.totalCosts ?? reportData.kpis.expenses,
            netIncome: fitnessKpis.netIncome ?? reportData.kpis.netIncome,
            burnRate: fitnessKpis.burnRate ?? reportData.kpis.burnRate,
            runway: fitnessKpis.runway ?? reportData.kpis.cashRunway,
          };

          console.log("[ReportsTab] Merged Fitness Studio KPIs:", {
            ...mergedKpis,
            keys: Object.keys(mergedKpis),
            sampleValues: Object.entries(mergedKpis).slice(0, 5),
          });

          fitnessStudioData = {
            kpis: mergedKpis,
            fromDate,
            toDate,
          };
        } catch (error) {
          console.error(
            "[ReportsTab] Failed to fetch fitness studio data:",
            error
          );
          // Don't fail the whole report generation, just log the error
          // Set empty data so PDF can still generate
          fitnessStudioData = {
            kpis: {},
            fromDate,
            toDate,
          };
        }
      }

      // Step 3: Generate AI insights (only for SaaS reports, not fitness studio)
      let insights: {
        overview?: string[];
        financial?: string[];
        pipeline?: string[];
        cashflow?: string[];
      } = {};

      // Skip insights generation for fitness studio reports (not used in PDF)
      if (!isFitnessStudio) {
        setGenerationProgress({
          currentStep: 3,
          totalSteps,
          stepName: "Generating AI insights...",
        });

        try {
          const [ov, fin, pipe, cf] = await Promise.all([
            generateInsights(reportData, "overview"),
            generateInsights(reportData, "financial"),
            generateInsights(reportData, "pipeline"),
            generateInsights(reportData, "cashflow"),
          ]);
          insights = {
            overview: ov,
            financial: fin,
            pipeline: pipe,
            cashflow: cf,
          };
        } catch (insightError) {
          console.warn(
            "AI insights generation failed, proceeding without insights:",
            insightError
          );
          // Continue with empty insights if OpenAI fails
        }
      } else {
        console.log(
          "[ReportsTab] Skipping AI insights generation for fitness studio report"
        );
      }

      // Step 4: Generate chart images
      const chartStep = isFitnessStudio ? 3 : 4;
      setGenerationProgress({
        currentStep: chartStep,
        totalSteps,
        stepName: "Generating chart images...",
      });

      const chartImages = await generateChartImages(reportData);

      // Step 5: Generate PDF
      setGenerationProgress({
        currentStep: totalSteps,
        totalSteps,
        stepName: "Generating PDF document...",
      });

      // Generate PDF with live data, AI insights, chart images, and user preferences
      await generateReportSlides(
        reportData,
        {
          company: config.companyName || "Milton Demo",
          periodLabel: config.reportPeriod || "Current Month",
          currency: prefs.currency,
          dateFormat: prefs.date_format,
          numberFormat: prefs.number_format,
          timezone: prefs.timezone,
          businessModel: businessModel || undefined,
        },
        insights,
        chartImages,
        config,
        fitnessStudioData
      );

      setGenerationStatus("success");
      setGenerationProgress(null);
      setTimeout(() => setGenerationStatus("idle"), 3000);
    } catch (err) {
      console.error("PDF Generation Error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate PDF. Please try again."
      );
      setGenerationStatus("error");
      setGenerationProgress(null);
    } finally {
      setIsGenerating(false);
    }
  };

  // Don't render until client-side
  if (!isClient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Generate PDF Report
          </CardTitle>
          <CardDescription>Loading PDF generator...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Generate PDF Report
          </CardTitle>
          <CardDescription>
            Create a professional PDF report with your current KPIs and
            analytics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Data Availability Check */}
          <DataAvailabilityAlert dataStatus={dataStatus} />

          {/* Report Configuration */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Report Title</Label>
              <Input
                id="title"
                value={config.title}
                onChange={(e) => handleConfigChange("title", e.target.value)}
                placeholder="Monthly Business Report"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company">Company Name</Label>
              <Input
                id="company"
                value={config.companyName}
                onChange={(e) =>
                  handleConfigChange("companyName", e.target.value)
                }
                placeholder="Your Company Name"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Report Period</Label>
              <MonthYearPicker
                value={config.reportPeriod}
                onChange={(value) => handleConfigChange("reportPeriod", value)}
                minYear={2024}
                maxYear={new Date().getFullYear()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessModel">Business Model</Label>
              <Input
                id="businessModel"
                value={config.businessModel || "Not set"}
                disabled
                className="bg-muted"
              />
            </div>
          </div>

          {/* Fitness Studio Sections */}
          {businessModel &&
            businessModel.toLowerCase().replace(/\s+/g, "_") ===
              "fitness_studio" &&
            !loadingBusinessModel && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4" />
                  <span>
                    Select sections and cards to include in your PDF report
                  </span>
                </div>

                {/* Executive Overview */}
                {config.executiveOverview && (
                  <ReportSection
                    id="executiveOverview"
                    title="Executive Overview"
                    description="Key metrics and high-level performance summary"
                    enabled={config.executiveOverview.enabled}
                    cards={[
                      {
                        id: "activeMembers",
                        label: "Active Members (end of period)",
                        enabled: config.executiveOverview.cards.activeMembers,
                      },
                      {
                        id: "monthlyRevenue",
                        label: "Monthly Revenue",
                        enabled: config.executiveOverview.cards.monthlyRevenue,
                      },
                      {
                        id: "netIncome",
                        label: "Net Income",
                        enabled: config.executiveOverview.cards.netIncome,
                      },
                      {
                        id: "utilizationRate",
                        label: "Utilization Rate",
                        enabled: config.executiveOverview.cards.utilizationRate,
                      },
                      {
                        id: "monthlyChurnRate",
                        label: "Monthly Churn Rate",
                        enabled:
                          config.executiveOverview.cards.monthlyChurnRate,
                      },
                      {
                        id: "cashRunway",
                        label: "Cash Runway (if available)",
                        enabled: config.executiveOverview.cards.cashRunway,
                      },
                    ]}
                    charts={[
                      {
                        id: "membersOverTime",
                        label: "Members Over Time (line)",
                        enabled:
                          config.executiveOverview.charts.membersOverTime,
                      },
                      {
                        id: "revenueTrend",
                        label: "Revenue Trend (line)",
                        enabled: config.executiveOverview.charts.revenueTrend,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("executiveOverview", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("executiveOverview", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("executiveOverview", chartId, enabled)
                    }
                    slideNumber={2}
                  />
                )}

                {/* Studio Performance */}
                {config.studioPerformance && (
                  <ReportSection
                    id="studioPerformance"
                    title="Studio Performance"
                    description="Member metrics, churn, and utilization"
                    enabled={config.studioPerformance.enabled}
                    cards={[
                      {
                        id: "activeMembers",
                        label: "Active Members",
                        enabled: config.studioPerformance.cards.activeMembers,
                      },
                      {
                        id: "newMembers",
                        label: "New Members",
                        enabled: config.studioPerformance.cards.newMembers,
                      },
                      {
                        id: "churnRate",
                        label: "Churn Rate",
                        enabled: config.studioPerformance.cards.churnRate,
                      },
                      {
                        id: "avgMemberTenure",
                        label: "Avg Member Tenure",
                        enabled: config.studioPerformance.cards.avgMemberTenure,
                      },
                      {
                        id: "revenuePerMember",
                        label: "Revenue per Member",
                        enabled:
                          config.studioPerformance.cards.revenuePerMember,
                      },
                      {
                        id: "utilizationRate",
                        label: "Utilization Rate",
                        enabled: config.studioPerformance.cards.utilizationRate,
                      },
                      {
                        id: "cancellationRate",
                        label: "Cancellation Rate",
                        enabled:
                          config.studioPerformance.cards.cancellationRate,
                      },
                      {
                        id: "noShowRate",
                        label: "No-show Rate",
                        enabled: config.studioPerformance.cards.noShowRate,
                      },
                    ]}
                    charts={[
                      {
                        id: "newVsChurned",
                        label: "Members: New vs Churned (grouped bar)",
                        enabled: config.studioPerformance.charts.newVsChurned,
                      },
                      {
                        id: "churnRateTrend",
                        label: "Churn Rate Trend (line)",
                        enabled: config.studioPerformance.charts.churnRateTrend,
                      },
                      {
                        id: "revenuePerMemberTrend",
                        label: "Revenue per Member Trend (line)",
                        enabled:
                          config.studioPerformance.charts.revenuePerMemberTrend,
                      },
                      {
                        id: "utilizationHeatmap",
                        label: "Utilization Heatmap (weekday × hour)",
                        enabled:
                          config.studioPerformance.charts.utilizationHeatmap,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("studioPerformance", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("studioPerformance", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("studioPerformance", chartId, enabled)
                    }
                    slideNumber={3}
                  />
                )}

                {/* Classes & Utilization */}
                {config.classesUtilization && (
                  <ReportSection
                    id="classesUtilization"
                    title="Classes & Utilization"
                    description="Class performance and capacity metrics"
                    enabled={config.classesUtilization.enabled}
                    cards={[
                      {
                        id: "totalClassesHeld",
                        label: "Total Classes Held",
                        enabled:
                          config.classesUtilization.cards.totalClassesHeld,
                      },
                      {
                        id: "avgClassOccupancy",
                        label: "Avg Class Occupancy",
                        enabled:
                          config.classesUtilization.cards.avgClassOccupancy,
                      },
                      {
                        id: "capacityUtilization",
                        label: "Capacity Utilization",
                        enabled:
                          config.classesUtilization.cards.capacityUtilization,
                      },
                      {
                        id: "avgAttendeesPerClass",
                        label: "Avg Attendees per Class",
                        enabled:
                          config.classesUtilization.cards.avgAttendeesPerClass,
                      },
                      {
                        id: "revenuePerClass",
                        label: "Revenue per Class (if enabled)",
                        enabled:
                          config.classesUtilization.cards.revenuePerClass,
                      },
                    ]}
                    charts={[
                      {
                        id: "occupancyTrend",
                        label: "Occupancy Trend (line)",
                        enabled:
                          config.classesUtilization.charts.occupancyTrend,
                      },
                      {
                        id: "utilizationTrend",
                        label: "Utilization Trend (line)",
                        enabled:
                          config.classesUtilization.charts.utilizationTrend,
                      },
                      {
                        id: "classOutcomes",
                        label:
                          "Class Outcomes (stacked bar: attended / cancelled / no-show)",
                        enabled: config.classesUtilization.charts.classOutcomes,
                      },
                      {
                        id: "top10ClassesByOccupancy",
                        label: "Top 10 Classes by Occupancy (horizontal bar)",
                        enabled:
                          config.classesUtilization.charts
                            .top10ClassesByOccupancy,
                      },
                      {
                        id: "top10ClassesByRevenue",
                        label:
                          "Top 10 Classes by Revenue (horizontal bar, optional)",
                        enabled:
                          config.classesUtilization.charts
                            .top10ClassesByRevenue,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("classesUtilization", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("classesUtilization", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("classesUtilization", chartId, enabled)
                    }
                    slideNumber={4}
                  />
                )}

                {/* Members */}
                {config.members && (
                  <ReportSection
                    id="members"
                    title="Members"
                    description="Member base analysis and demographics"
                    enabled={config.members.enabled}
                    cards={[
                      {
                        id: "totalMembers",
                        label: "Total Members",
                        enabled: config.members.cards.totalMembers,
                      },
                      {
                        id: "activeMembers",
                        label: "Active Members",
                        enabled: config.members.cards.activeMembers,
                      },
                      {
                        id: "netMemberGrowth",
                        label: "Net Member Growth",
                        enabled: config.members.cards.netMemberGrowth,
                      },
                      {
                        id: "avgMemberTenure",
                        label: "Avg Member Tenure",
                        enabled: config.members.cards.avgMemberTenure,
                      },
                      {
                        id: "engagementRate",
                        label: "Engagement Rate",
                        enabled: config.members.cards.engagementRate,
                      },
                    ]}
                    charts={[
                      {
                        id: "memberBaseOverTime",
                        label: "Member Base Over Time (line)",
                        enabled: config.members.charts.memberBaseOverTime,
                      },
                      {
                        id: "tenureDistribution",
                        label: "Tenure Distribution (bar or donut)",
                        enabled: config.members.charts.tenureDistribution,
                      },
                      {
                        id: "subscriptionTypeSplit",
                        label: "Subscription Type Split (donut)",
                        enabled: config.members.charts.subscriptionTypeSplit,
                      },
                      {
                        id: "genderSplit",
                        label: "Gender Split (donut, optional)",
                        enabled: config.members.charts.genderSplit,
                      },
                      {
                        id: "ageBands",
                        label: "Age Bands (bar, optional)",
                        enabled: config.members.charts.ageBands,
                      },
                      {
                        id: "engagementDistribution",
                        label: "Engagement Distribution (bar)",
                        enabled: config.members.charts.engagementDistribution,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("members", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("members", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("members", chartId, enabled)
                    }
                    slideNumber={5}
                  />
                )}

                {/* Instructors */}
                {config.instructors && (
                  <ReportSection
                    id="instructors"
                    title="Instructors"
                    description="Instructor performance and ratings"
                    enabled={config.instructors.enabled}
                    cards={[
                      {
                        id: "activeInstructors",
                        label: "Active Instructors",
                        enabled: config.instructors.cards.activeInstructors,
                      },
                      {
                        id: "classesTaught",
                        label: "Classes Taught",
                        enabled: config.instructors.cards.classesTaught,
                      },
                      {
                        id: "avgOccupancyPerInstructor",
                        label: "Avg Occupancy per Instructor",
                        enabled:
                          config.instructors.cards.avgOccupancyPerInstructor,
                      },
                      {
                        id: "revenuePerInstructor",
                        label: "Revenue per Instructor",
                        enabled: config.instructors.cards.revenuePerInstructor,
                      },
                      {
                        id: "instructorCancellationRate",
                        label: "Instructor Cancellation Rate",
                        enabled:
                          config.instructors.cards.instructorCancellationRate,
                      },
                    ]}
                    charts={[
                      {
                        id: "instructorRankingByRevenue",
                        label: "Instructor Ranking by Revenue (bar)",
                        enabled:
                          config.instructors.charts.instructorRankingByRevenue,
                      },
                      {
                        id: "instructorRankingByOccupancy",
                        label: "Instructor Ranking by Occupancy (bar)",
                        enabled:
                          config.instructors.charts
                            .instructorRankingByOccupancy,
                      },
                      {
                        id: "classesTaughtPerInstructor",
                        label: "Classes Taught per Instructor (bar)",
                        enabled:
                          config.instructors.charts.classesTaughtPerInstructor,
                      },
                      {
                        id: "cancellationRateByInstructor",
                        label: "Cancellation Rate by Instructor (bar)",
                        enabled:
                          config.instructors.charts
                            .cancellationRateByInstructor,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("instructors", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("instructors", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("instructors", chartId, enabled)
                    }
                    slideNumber={6}
                  />
                )}

                {/* Financials */}
                {config.financials && (
                  <ReportSection
                    id="financials"
                    title="Financials"
                    description="Revenue, expenses, and margins"
                    enabled={config.financials.enabled}
                    cards={[
                      {
                        id: "totalRevenue",
                        label: "Total Revenue",
                        enabled: config.financials.cards.totalRevenue,
                      },
                      {
                        id: "totalCosts",
                        label: "Total Costs",
                        enabled: config.financials.cards.totalCosts,
                      },
                      {
                        id: "netIncome",
                        label: "Net Income",
                        enabled: config.financials.cards.netIncome,
                      },
                      {
                        id: "grossMargin",
                        label: "Gross Margin",
                        enabled: config.financials.cards.grossMargin,
                      },
                    ]}
                    charts={[
                      {
                        id: "revenueTrend",
                        label: "Revenue Trend (line)",
                        enabled: config.financials.charts.revenueTrend,
                      },
                      {
                        id: "netIncomeTrend",
                        label: "Net Income Trend (line)",
                        enabled: config.financials.charts.netIncomeTrend,
                      },
                      {
                        id: "revenueBreakdown",
                        label: "Revenue Breakdown (donut)",
                        enabled: config.financials.charts.revenueBreakdown,
                      },
                      {
                        id: "costBreakdown",
                        label: "Cost Breakdown (horizontal bar)",
                        enabled: config.financials.charts.costBreakdown,
                      },
                      {
                        id: "budgetVsActual",
                        label: "Budget vs Actual (line, optional)",
                        enabled: config.financials.charts.budgetVsActual,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("financials", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("financials", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("financials", chartId, enabled)
                    }
                    slideNumber={7}
                  />
                )}

                {/* Cash Flow */}
                {config.cashFlow && (
                  <ReportSection
                    id="cashFlow"
                    title="Cash Flow"
                    description="Cash trends and runway"
                    enabled={config.cashFlow.enabled}
                    cards={[
                      {
                        id: "netCashFlow",
                        label: "Net Cash Flow",
                        enabled: config.cashFlow.cards.netCashFlow,
                      },
                      {
                        id: "burnRate",
                        label: "Burn Rate",
                        enabled: config.cashFlow.cards.burnRate,
                      },
                      {
                        id: "runway",
                        label: "Runway (if available)",
                        enabled: config.cashFlow.cards.runway,
                      },
                    ]}
                    charts={[
                      {
                        id: "inflowsVsOutflows",
                        label: "Inflows vs Outflows (grouped bar)",
                        enabled: config.cashFlow.charts.inflowsVsOutflows,
                      },
                      {
                        id: "netCashFlowTrend",
                        label: "Net Cash Flow Trend (bar)",
                        enabled: config.cashFlow.charts.netCashFlowTrend,
                      },
                      {
                        id: "cumulativeCashFlow",
                        label: "Cumulative Cash Flow (line)",
                        enabled: config.cashFlow.charts.cumulativeCashFlow,
                      },
                      {
                        id: "outflowsByCategory",
                        label: "Outflows by Category (horizontal bar)",
                        enabled: config.cashFlow.charts.outflowsByCategory,
                      },
                    ]}
                    onToggleSection={(enabled) =>
                      handleToggleSection("cashFlow", enabled)
                    }
                    onToggleCard={(cardId, enabled) =>
                      handleToggleCard("cashFlow", cardId, enabled)
                    }
                    onToggleChart={(chartId, enabled) =>
                      handleToggleChart("cashFlow", chartId, enabled)
                    }
                    slideNumber={8}
                  />
                )}
              </div>
            )}

          {/* Non-fitness studio message */}
          {businessModel &&
            businessModel.toLowerCase().replace(/\s+/g, "_") !==
              "fitness_studio" &&
            !loadingBusinessModel && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Reporting is currently tailored for Fitness Studio business
                  models. Other business models will be supported soon.
                </AlertDescription>
              </Alert>
            )}

          {/* Status Messages */}
          {generationStatus === "generating" && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Fetching live data from Supabase and generating your PDF
                report...
              </AlertDescription>
            </Alert>
          )}

          {generationStatus === "success" && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                PDF report generated successfully! Check your downloads folder.
              </AlertDescription>
            </Alert>
          )}

          {generationStatus === "error" && error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Data Status Warning */}
          {!dataStatus.hasAnyData && (
            <Alert className="border-yellow-200 bg-yellow-50">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                No data available. Please upload transactions, CRM deals, or
                budget data to generate a report.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress Indicator */}
          {generationProgress && (
            <div className="space-y-2 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-blue-900 dark:text-blue-100">
                  {generationProgress.stepName}
                </span>
                <span className="text-blue-700 dark:text-blue-300">
                  {generationProgress.currentStep} of{" "}
                  {generationProgress.totalSteps}
                </span>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2.5">
                <div
                  className="bg-blue-600 dark:bg-blue-400 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${(generationProgress.currentStep / generationProgress.totalSteps) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="space-y-2">
            <Button
              onClick={generatePDF}
              disabled={
                isGenerating ||
                !businessModel ||
                businessModel.toLowerCase().replace(/\s+/g, "_") !==
                  "fitness_studio" ||
                !dataStatus.hasAnyData
              }
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" />
                  Generate PDF Report
                </>
              )}
            </Button>
            {businessModel &&
              businessModel.toLowerCase().replace(/\s+/g, "_") !==
                "fitness_studio" && (
                <p className="text-xs text-center text-muted-foreground">
                  PDF generation is only available for Fitness Studio business
                  models
                </p>
              )}
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Report Preview */}
      <ReportPreview config={config} />

      {/* Features Note */}
      <div className="text-xs text-gray-600 space-y-1">
        <p>
          <strong>This PDF includes:</strong>
        </p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Professional slide-based layout with standardized formatting</li>
          <li>Only your selected cards and insights</li>
          <li>Real financial data from your uploaded files</li>
          <li>Consistent margins and alignment across all slides</li>
          <li>Dynamic charts generated from live data</li>
        </ul>
      </div>
    </div>
  );
}
