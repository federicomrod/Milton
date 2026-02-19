// components/dashboard/reports/ReportPreview.tsx
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportConfig } from "@/lib/types/report";

interface ReportPreviewProps {
  config: ReportConfig;
}

function getEnabledCards(section: any): string[] {
  if (!section?.enabled || !section?.cards) return [];
  return Object.entries(section.cards)
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);
}

function getEnabledCharts(section: any): string[] {
  if (!section?.enabled || !section?.charts) return [];
  return Object.entries(section.charts)
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);
}

function getCardLabel(cardId: string, sectionId: string): string {
  const labels: Record<string, Record<string, string>> = {
    executiveOverview: {
      activeMembers: "Active Members (end of period)",
      monthlyRevenue: "Monthly Revenue",
      netIncome: "Net Income",
      utilizationRate: "Utilization Rate",
      monthlyChurnRate: "Monthly Churn Rate",
      cashRunway: "Cash Runway",
    },
    studioPerformance: {
      activeMembers: "Active Members",
      newMembers: "New Members",
      churnRate: "Churn Rate",
      avgMemberTenure: "Avg Member Tenure",
      revenuePerMember: "Revenue per Member",
      utilizationRate: "Utilization Rate",
      cancellationRate: "Cancellation Rate",
      noShowRate: "No-show Rate",
    },
    classesUtilization: {
      totalClassesHeld: "Total Classes Held",
      avgClassOccupancy: "Avg Class Occupancy",
      capacityUtilization: "Capacity Utilization",
      avgAttendeesPerClass: "Avg Attendees per Class",
      revenuePerClass: "Revenue per Class",
    },
    members: {
      totalMembers: "Total Members",
      activeMembers: "Active Members",
      netMemberGrowth: "Net Member Growth",
      avgMemberTenure: "Avg Member Tenure",
      engagementRate: "Engagement Rate",
    },
    instructors: {
      activeInstructors: "Active Instructors",
      classesTaught: "Classes Taught",
      avgOccupancyPerInstructor: "Avg Occupancy per Instructor",
      revenuePerInstructor: "Revenue per Instructor",
      instructorCancellationRate: "Instructor Cancellation Rate",
    },
    financials: {
      totalRevenue: "Total Revenue",
      totalCosts: "Total Costs",
      netIncome: "Net Income",
      grossMargin: "Gross Margin",
    },
    cashFlow: {
      netCashFlow: "Net Cash Flow",
      burnRate: "Burn Rate",
      runway: "Runway",
    },
    restaurantOverview: {
      totalRevenue: "Total Revenue",
      covers: "Covers",
      averageTicketSize: "Average Ticket Size",
      primeCostPercent: "Prime Cost %",
      totalCOGS: "Total COGS",
      totalLabor: "Total Labor",
      primeCost: "Prime Cost",
    },
    operations: {
      tableUtilization: "Table Utilization",
      reservationsEffectiveness: "Reservations Effectiveness",
    },
    restaurantCashFlow: {
      netCashFlow: "Net Cash Flow",
      burnRate: "Burn Rate",
      cashBalance: "Cash Balance",
      cashRunway: "Cash Runway",
    },
  };
  return labels[sectionId]?.[cardId] || cardId;
}

function getChartLabel(chartId: string, sectionId: string): string {
  const labels: Record<string, Record<string, string>> = {
    executiveOverview: {
      membersOverTime: "Members Over Time (line)",
      revenueTrend: "Revenue Trend (line)",
    },
    studioPerformance: {
      newVsChurned: "Members: New vs Churned (grouped bar)",
      churnRateTrend: "Churn Rate Trend (line)",
      revenuePerMemberTrend: "Revenue per Member Trend (line)",
      utilizationHeatmap: "Utilization Heatmap (weekday × hour)",
    },
    classesUtilization: {
      occupancyTrend: "Occupancy Trend (line)",
      utilizationTrend: "Utilization Trend (line)",
      classOutcomes: "Class Outcomes (stacked bar)",
      top10ClassesByOccupancy: "Top 10 Classes by Occupancy (horizontal bar)",
      top10ClassesByRevenue: "Top 10 Classes by Revenue (horizontal bar)",
    },
    members: {
      memberBaseOverTime: "Member Base Over Time (line)",
      tenureDistribution: "Tenure Distribution (bar or donut)",
      subscriptionTypeSplit: "Subscription Type Split (donut)",
      genderSplit: "Gender Split (donut)",
      ageBands: "Age Bands (bar)",
      engagementDistribution: "Engagement Distribution (bar)",
    },
    instructors: {
      instructorRankingByRevenue: "Instructor Ranking by Revenue (bar)",
      instructorRankingByOccupancy: "Instructor Ranking by Occupancy (bar)",
      classesTaughtPerInstructor: "Classes Taught per Instructor (bar)",
      cancellationRateByInstructor: "Cancellation Rate by Instructor (bar)",
    },
    financials: {
      revenueTrend: "Revenue Trend (line)",
      netIncomeTrend: "Net Income Trend (line)",
      revenueBreakdown: "Revenue Breakdown (donut)",
      costBreakdown: "Cost Breakdown (horizontal bar)",
      budgetVsActual: "Budget vs Actual (line)",
    },
    cashFlow: {
      inflowsVsOutflows: "Inflows vs Outflows (grouped bar)",
      netCashFlowTrend: "Net Cash Flow Trend (bar)",
      cumulativeCashFlow: "Cumulative Cash Flow (line)",
      outflowsByCategory: "Outflows by Category (horizontal bar)",
    },
    restaurantOverview: {
      salesTrend: "Sales Trend (line)",
    },
    revenueMenu: {
      salesTrends: "Sales Trends (line)",
      categoryBreakdown: "Revenue by Category (donut)",
      channelBreakdown: "Revenue by Channel (bar)",
      topItems: "Top Performing Items (table)",
      bottomItems: "Bottom Performing Items (table)",
    },
    operations: {
      coversByDay: "Covers by Day of Week (bar)",
      coversByHour: "Covers by Hour (line)",
      peakTimes: "Peak Times (list)",
    },
    restaurantCashFlow: {
      cashFlowOverview: "Cash Flow Overview (bar)",
      inflowsByCategory: "Inflows by Category (table)",
      outflowsByCategory: "Outflows by Category (table)",
    },
  };
  return labels[sectionId]?.[chartId] || chartId;
}

function getSectionTitle(sectionId: string): string {
  const titles: Record<string, string> = {
    executiveOverview: "Executive Overview",
    studioPerformance: "Studio Performance",
    classesUtilization: "Classes & Utilization",
    members: "Members",
    instructors: "Instructors",
    financials: "Financials",
    cashFlow: "Cash Flow",
    restaurantOverview: "Executive Overview",
    revenueMenu: "Revenue & Menu Performance",
    operations: "Operations",
    restaurantCashFlow: "Cash Flow",
  };
  return titles[sectionId] || sectionId;
}

function getSectionColor(sectionId: string): string {
  const colors: Record<string, string> = {
    executiveOverview: "from-blue-50 to-blue-100 border-blue-500",
    studioPerformance: "from-green-50 to-green-100 border-green-500",
    classesUtilization: "from-purple-50 to-purple-100 border-purple-500",
    members: "from-orange-50 to-orange-100 border-orange-500",
    instructors: "from-pink-50 to-pink-100 border-pink-500",
    financials: "from-teal-50 to-teal-100 border-teal-500",
    cashFlow: "from-indigo-50 to-indigo-100 border-indigo-500",
    restaurantOverview: "from-blue-50 to-blue-100 border-blue-500",
    revenueMenu: "from-amber-50 to-amber-100 border-amber-500",
    operations: "from-emerald-50 to-emerald-100 border-emerald-500",
    restaurantCashFlow: "from-indigo-50 to-indigo-100 border-indigo-500",
  };
  return colors[sectionId] || "from-gray-50 to-gray-100 border-gray-500";
}

export function ReportPreview({ config }: ReportPreviewProps) {
  const isFitnessStudio =
    config.businessModel &&
    config.businessModel.toLowerCase().replace(/\s+/g, "_") ===
      "fitness_studio";
  const isRestaurant =
    config.businessModel &&
    config.businessModel.toLowerCase().replace(/\s+/g, "_") === "restaurant";

  // Calculate total slides
  let slideCount = 1; // Cover slide
  const sections = isRestaurant
    ? [
        config.restaurantOverview,
        config.revenueMenu,
        config.operations,
        config.restaurantCashFlow,
      ]
    : [
        config.executiveOverview,
        config.studioPerformance,
        config.classesUtilization,
        config.members,
        config.instructors,
        config.financials,
        config.cashFlow,
      ];

  // Track slide numbers for each section
  const sectionSlideNumbers: Record<string, number[]> = {};

  sections.forEach((section, index) => {
    if (section?.enabled) {
      const enabledCards = getEnabledCards(section);
      const enabledCharts = getEnabledCharts(section);

      // PDF generator shows max 6 cards per slide (only first 6)
      const cardsToShow = Math.min(enabledCards.length, 6);
      const hasCards = cardsToShow > 0;

      // Charts: first 2 can share page with cards, then 2 per additional page
      const chartsOnFirstPage = Math.min(enabledCharts.length, 2);
      const remainingCharts = Math.max(0, enabledCharts.length - 2);
      const additionalChartSlides = Math.ceil(remainingCharts / 2);

      // Calculate total slides for this section
      let sectionSlides: number;
      if (hasCards || enabledCharts.length > 0) {
        // At least 1 slide (for cards, or first 2 charts, or both)
        sectionSlides = 1 + additionalChartSlides;
      } else {
        sectionSlides = 0;
      }

      const sectionSlidesList: number[] = [];
      for (let i = 0; i < sectionSlides; i++) {
        sectionSlidesList.push(slideCount + i);
      }

      const sectionKeys = isRestaurant
        ? [
            "restaurantOverview",
            "revenueMenu",
            "operations",
            "restaurantCashFlow",
          ]
        : [
            "executiveOverview",
            "studioPerformance",
            "classesUtilization",
            "members",
            "instructors",
            "financials",
            "cashFlow",
          ];
      sectionSlideNumbers[sectionKeys[index]] = sectionSlidesList;

      slideCount += sectionSlides;
    }
  });

  if (!isFitnessStudio && !isRestaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Preview</CardTitle>
          <CardDescription>
            Preview will appear when Fitness Studio or Restaurant business model
            is selected
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Report Preview</CardTitle>
            <CardDescription>
              Preview of your report structure and slides
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-sm">
            {slideCount} {slideCount === 1 ? "Slide" : "Slides"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Cover Slide */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border-l-4 border-blue-500">
            <div>
              <h3 className="font-semibold">Cover Slide</h3>
              <p className="text-sm text-gray-600">
                {config.title} • {config.companyName} • {config.reportPeriod}
              </p>
            </div>
            <Badge variant="secondary">Always Included</Badge>
          </div>

          {/* Sections */}
          {config.executiveOverview?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "executiveOverview"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("executiveOverview")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.executiveOverview?.length === 1
                    ? `Slide ${sectionSlideNumbers.executiveOverview[0]}`
                    : `Slides ${sectionSlideNumbers.executiveOverview?.[0]}-${sectionSlideNumbers.executiveOverview?.[sectionSlideNumbers.executiveOverview.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.executiveOverview).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "executiveOverview")}
                  </div>
                ))}
                {getEnabledCharts(config.executiveOverview).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "executiveOverview")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.studioPerformance?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "studioPerformance"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("studioPerformance")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.studioPerformance?.length === 1
                    ? `Slide ${sectionSlideNumbers.studioPerformance[0]}`
                    : `Slides ${sectionSlideNumbers.studioPerformance?.[0]}-${sectionSlideNumbers.studioPerformance?.[sectionSlideNumbers.studioPerformance.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.studioPerformance).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "studioPerformance")}
                  </div>
                ))}
                {getEnabledCharts(config.studioPerformance).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "studioPerformance")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.classesUtilization?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "classesUtilization"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("classesUtilization")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.classesUtilization?.length === 1
                    ? `Slide ${sectionSlideNumbers.classesUtilization[0]}`
                    : `Slides ${sectionSlideNumbers.classesUtilization?.[0]}-${sectionSlideNumbers.classesUtilization?.[sectionSlideNumbers.classesUtilization.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.classesUtilization).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "classesUtilization")}
                  </div>
                ))}
                {getEnabledCharts(config.classesUtilization).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "classesUtilization")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.members?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "members"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{getSectionTitle("members")}</h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.members?.length === 1
                    ? `Slide ${sectionSlideNumbers.members[0]}`
                    : `Slides ${sectionSlideNumbers.members?.[0]}-${sectionSlideNumbers.members?.[sectionSlideNumbers.members.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.members).map((cardId) => (
                  <div key={cardId}>• {getCardLabel(cardId, "members")}</div>
                ))}
                {getEnabledCharts(config.members).map((chartId) => (
                  <div key={chartId}>• {getChartLabel(chartId, "members")}</div>
                ))}
              </div>
            </div>
          )}

          {config.instructors?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "instructors"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("instructors")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.instructors?.length === 1
                    ? `Slide ${sectionSlideNumbers.instructors[0]}`
                    : `Slides ${sectionSlideNumbers.instructors?.[0]}-${sectionSlideNumbers.instructors?.[sectionSlideNumbers.instructors.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.instructors).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "instructors")}
                  </div>
                ))}
                {getEnabledCharts(config.instructors).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "instructors")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.financials?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "financials"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("financials")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.financials?.length === 1
                    ? `Slide ${sectionSlideNumbers.financials[0]}`
                    : `Slides ${sectionSlideNumbers.financials?.[0]}-${sectionSlideNumbers.financials?.[sectionSlideNumbers.financials.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.financials).map((cardId) => (
                  <div key={cardId}>• {getCardLabel(cardId, "financials")}</div>
                ))}
                {getEnabledCharts(config.financials).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "financials")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.cashFlow?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "cashFlow"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{getSectionTitle("cashFlow")}</h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.cashFlow?.length === 1
                    ? `Slide ${sectionSlideNumbers.cashFlow[0]}`
                    : `Slides ${sectionSlideNumbers.cashFlow?.[0]}-${sectionSlideNumbers.cashFlow?.[sectionSlideNumbers.cashFlow.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.cashFlow).map((cardId) => (
                  <div key={cardId}>• {getCardLabel(cardId, "cashFlow")}</div>
                ))}
                {getEnabledCharts(config.cashFlow).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "cashFlow")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restaurant Sections */}
          {config.restaurantOverview?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "restaurantOverview"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("restaurantOverview")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.restaurantOverview?.length === 1
                    ? `Slide ${sectionSlideNumbers.restaurantOverview[0]}`
                    : `Slides ${sectionSlideNumbers.restaurantOverview?.[0]}-${sectionSlideNumbers.restaurantOverview?.[sectionSlideNumbers.restaurantOverview.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.restaurantOverview).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "restaurantOverview")}
                  </div>
                ))}
                {getEnabledCharts(config.restaurantOverview).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "restaurantOverview")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.revenueMenu?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "revenueMenu"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("revenueMenu")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.revenueMenu?.length === 1
                    ? `Slide ${sectionSlideNumbers.revenueMenu[0]}`
                    : `Slides ${sectionSlideNumbers.revenueMenu?.[0]}-${sectionSlideNumbers.revenueMenu?.[sectionSlideNumbers.revenueMenu.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.revenueMenu).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "revenueMenu")}
                  </div>
                ))}
                {getEnabledCharts(config.revenueMenu).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "revenueMenu")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.operations?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "operations"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("operations")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.operations?.length === 1
                    ? `Slide ${sectionSlideNumbers.operations[0]}`
                    : `Slides ${sectionSlideNumbers.operations?.[0]}-${sectionSlideNumbers.operations?.[sectionSlideNumbers.operations.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.operations).map((cardId) => (
                  <div key={cardId}>• {getCardLabel(cardId, "operations")}</div>
                ))}
                {getEnabledCharts(config.operations).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "operations")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.restaurantCashFlow?.enabled && (
            <div
              className={`p-4 bg-gradient-to-r ${getSectionColor(
                "restaurantCashFlow"
              )} rounded-lg border-l-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {getSectionTitle("restaurantCashFlow")}
                </h3>
                <Badge variant="outline">
                  {sectionSlideNumbers.restaurantCashFlow?.length === 1
                    ? `Slide ${sectionSlideNumbers.restaurantCashFlow[0]}`
                    : `Slides ${sectionSlideNumbers.restaurantCashFlow?.[0]}-${sectionSlideNumbers.restaurantCashFlow?.[sectionSlideNumbers.restaurantCashFlow.length - 1]}`}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {getEnabledCards(config.restaurantCashFlow).map((cardId) => (
                  <div key={cardId}>
                    • {getCardLabel(cardId, "restaurantCashFlow")}
                  </div>
                ))}
                {getEnabledCharts(config.restaurantCashFlow).map((chartId) => (
                  <div key={chartId}>
                    • {getChartLabel(chartId, "restaurantCashFlow")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {sections.every((s) => !s?.enabled) && (
            <div className="p-4 bg-gray-50 rounded-lg border-l-4 border-gray-300">
              <p className="text-sm text-gray-600 text-center">
                No sections enabled. Enable sections above to see preview.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
