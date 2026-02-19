// lib/pdf-generator-slides.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ReportData } from "@/lib/report-data-service";
import {
  formatCurrency as formatCurrencyUtil,
  formatNumber as formatNumberUtil,
  formatDate as formatDateUtil,
} from "@/lib/utils/formatters";

import type { ReportConfig as ReportConfigType } from "@/lib/types/report";

export interface ReportConfig {
  company?: string;
  periodLabel?: string;
  currency?: string;
  dateFormat?: string;
  numberFormat?: string;
  timezone?: string;
  businessModel?: string;
}

export interface ReportInsights {
  overview?: string[];
  financial?: string[];
  pipeline?: string[];
  cashflow?: string[];
  operations?: string[];
}

export interface ChartImages {
  overview?: string;
  financial?: string;
  pipeline?: string;
  cashflow?: string;
}

const theme = {
  primary: "#1E40AF", // Professional navy blue
  primaryDark: "#1E3A8A",
  primaryLight: "#EFF6FF",
  secondary: "#059669", // Professional green
  accent: "#DC2626", // Professional red for emphasis
  text: "#111827", // Deep charcoal
  lightText: "#4B5563", // Medium gray
  lighterText: "#9CA3AF", // Light gray
  background: "#FFFFFF",
  backgroundLight: "#F9FAFB",
  border: "#D1D5DB", // Subtle border
  borderLight: "#E5E7EB",
  tableHeader: "#1E40AF", // Navy for headers
  tableStripe: "#F3F4F6", // Very light gray for stripes
  font: "Helvetica",
  fontBold: "Helvetica-Bold",
  marginX: 72, // Standard 1 inch margin
  marginY: 72,
};

const layout = {
  pageW: 842, // approx A4 landscape width in pt
  pageH: 595, // approx height
  marginX: 60,
  marginY: 60,
};

const col = {
  leftX: layout.marginX,
  leftW: Math.floor((layout.pageW - layout.marginX * 2) * 0.66),
  rightX:
    layout.marginX +
    Math.floor((layout.pageW - layout.marginX * 2) * 0.66) +
    16,
  rightW: Math.floor((layout.pageW - layout.marginX * 2) * 0.34) - 16,
};

/**
 * Generate a multi-page slide-based PDF report with live Supabase data
 */
export async function generateReportSlides(
  data: ReportData,
  config?: ReportConfig,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  reportConfig?: ReportConfigType,
  fitnessStudioData?: any
): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  // Check if this is a fitness studio or restaurant report
  const isFitnessStudio =
    config?.businessModel === "fitness_studio" ||
    reportConfig?.businessModel === "fitness_studio";
  const isRestaurant =
    config?.businessModel === "restaurant" ||
    reportConfig?.businessModel === "restaurant";

  if (isFitnessStudio && reportConfig) {
    // Generate fitness studio report
    await generateFitnessStudioReport(
      doc,
      data,
      config,
      insights,
      chartImages,
      reportConfig,
      fitnessStudioData
    );
  } else if (isRestaurant && reportConfig) {
    // Generate restaurant report
    await generateRestaurantReport(
      doc,
      data,
      config,
      insights,
      chartImages,
      reportConfig,
      fitnessStudioData // Reuse the same data structure for restaurant data
    );
  } else {
    // Generate standard SaaS report
    /* PAGE 1: Overview */
    drawHeader(doc, config);
    drawOverviewPage(doc, data, insights, chartImages, config);
    doc.addPage();

    /* PAGE 2: Financial Analysis */
    drawHeader(doc, config);
    drawFinancialPage(doc, data, insights, chartImages, config);
    doc.addPage();

    /* PAGE 3: Sales Pipeline */
    drawHeader(doc, config);
    drawPipelinePage(doc, data, insights, chartImages, config);
    doc.addPage();

    /* PAGE 4: Cash Flow Analysis */
    drawHeader(doc, config);
    drawCashFlowPage(doc, data, insights, chartImages, config);
  }

  const filename = `${config?.company || "Milton"}_Report_${
    new Date().toISOString().split("T")[0]
  }.pdf`;
  doc.save(filename);
}

/**
 * Generate fitness studio PDF report with enabled sections
 */
async function generateFitnessStudioReport(
  doc: jsPDF,
  data: ReportData,
  config?: ReportConfig,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  reportConfig?: ReportConfigType,
  fitnessStudioData?: any
): Promise<void> {
  // Cover slide
  drawCoverSlide(doc, config, reportConfig);

  let slideNumber = 2;

  // Executive Overview
  if (reportConfig?.executiveOverview?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Executive Overview",
      slideNumber++,
      reportConfig.executiveOverview,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Studio Performance
  if (reportConfig?.studioPerformance?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Studio Performance",
      slideNumber++,
      reportConfig.studioPerformance,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Classes & Utilization
  if (reportConfig?.classesUtilization?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Classes & Utilization",
      slideNumber++,
      reportConfig.classesUtilization,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Members
  if (reportConfig?.members?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Members",
      slideNumber++,
      reportConfig.members,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Instructors
  if (reportConfig?.instructors?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Instructors",
      slideNumber++,
      reportConfig.instructors,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Financials
  if (reportConfig?.financials?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Financials",
      slideNumber++,
      reportConfig.financials,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }

  // Cash Flow
  if (reportConfig?.cashFlow?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawFitnessStudioSection(
      doc,
      "Cash Flow",
      slideNumber++,
      reportConfig.cashFlow,
      data,
      config,
      fitnessStudioData,
      insights
    );
  }
}

/**
 * Generate restaurant PDF report with enabled sections
 */
async function generateRestaurantReport(
  doc: jsPDF,
  data: ReportData,
  config?: ReportConfig,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  reportConfig?: ReportConfigType,
  restaurantData?: any
): Promise<void> {
  // Cover slide
  drawCoverSlide(doc, config, reportConfig);

  let slideNumber = 2;

  // Executive Overview
  if (reportConfig?.restaurantOverview?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawRestaurantSection(
      doc,
      "Executive Overview",
      slideNumber++,
      reportConfig.restaurantOverview,
      data,
      config,
      restaurantData,
      insights
    );
  }

  // Revenue & Menu Performance
  if (reportConfig?.revenueMenu?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawRestaurantSection(
      doc,
      "Revenue & Menu Performance",
      slideNumber++,
      reportConfig.revenueMenu,
      data,
      config,
      restaurantData,
      insights
    );
  }

  // Operations
  if (reportConfig?.operations?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawRestaurantSection(
      doc,
      "Operations",
      slideNumber++,
      reportConfig.operations,
      data,
      config,
      restaurantData,
      insights
    );
  }

  // Cash Flow
  if (reportConfig?.restaurantCashFlow?.enabled) {
    doc.addPage();
    drawHeader(doc, config, slideNumber);
    await drawRestaurantSection(
      doc,
      "Cash Flow",
      slideNumber++,
      reportConfig.restaurantCashFlow,
      data,
      config,
      restaurantData,
      insights
    );
  }
}

/**
 * Draw professional cover slide
 */
function drawCoverSlide(
  doc: jsPDF,
  config?: ReportConfig,
  reportConfig?: ReportConfigType
): void {
  // Use title from reportConfig (user input) or fallback to default
  const title =
    reportConfig?.title || config?.periodLabel || "Monthly Business Report";
  const company = config?.company || "Milton";
  const period = config?.periodLabel || "Current Month";
  const generated = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Top accent bar
  doc.setFillColor(30, 64, 175); // Navy blue
  doc.rect(0, 0, layout.pageW, 8, "F");

  // Main title - centered, large, professional
  doc.setFont(theme.fontBold, "bold");
  doc.setFontSize(36);
  doc.setTextColor(theme.text);
  doc.text(title, layout.pageW / 2, 180, { align: "center" });

  // Company name - smaller, below title
  doc.setFontSize(20);
  doc.setTextColor(theme.lightText);
  doc.text(company, layout.pageW / 2, 220, { align: "center" });

  // Horizontal divider line
  doc.setDrawColor(theme.border);
  doc.setLineWidth(1);
  doc.line(layout.pageW / 2 - 150, 260, layout.pageW / 2 + 150, 260);

  // Report period - centered
  doc.setFont(theme.font, "normal");
  doc.setFontSize(16);
  doc.setTextColor(theme.text);
  doc.text(period, layout.pageW / 2, 300, { align: "center" });

  // Bottom section with metadata
  const bottomY = 450;

  // Generated date
  doc.setFont(theme.font, "normal");
  doc.setFontSize(11);
  doc.setTextColor(theme.lightText);
  doc.text(`Generated: ${generated}`, layout.pageW / 2, bottomY, {
    align: "center",
  });

  // Footer line
  doc.setDrawColor(theme.border);
  doc.setLineWidth(0.5);
  doc.line(
    theme.marginX,
    layout.pageH - 40,
    layout.pageW - theme.marginX,
    layout.pageH - 40
  );

  // Confidential notice
  doc.setFont(theme.font, "normal");
  doc.setFontSize(9);
  doc.setTextColor(theme.lighterText);
  doc.text("CONFIDENTIAL", layout.pageW / 2, layout.pageH - 25, {
    align: "center",
  });
}

/**
 * Draw a fitness studio section with actual data
 */
async function drawFitnessStudioSection(
  doc: jsPDF,
  sectionTitle: string,
  slideNumber: number,
  section: any,
  data: ReportData,
  config?: ReportConfig,
  fitnessStudioData?: any,
  insights?: ReportInsights
): Promise<void> {
  // Professional section header
  const headerY = 60;

  // Section number and title
  doc.setFont(theme.fontBold, "bold");
  doc.setFontSize(18);
  doc.setTextColor(theme.text);
  doc.text(`${slideNumber}. ${sectionTitle}`, col.leftX, headerY);

  // Underline
  doc.setDrawColor(30, 64, 175); // Navy blue
  doc.setLineWidth(2);
  const textWidth = doc.getTextWidth(`${slideNumber}. ${sectionTitle}`);
  doc.line(col.leftX, headerY + 5, col.leftX + textWidth, headerY + 5);

  // Get enabled cards
  const enabledCards = Object.entries(section.cards || {})
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);

  // Get enabled charts
  const enabledCharts = Object.entries(section.charts || {})
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);

  // Import fitness studio data utilities
  const { getKpiValue, fetchFitnessStudioChart } =
    await import("@/lib/fitness-studio-report-data");

  const kpis = fitnessStudioData?.kpis || {};

  // Debug logging
  console.log(`[drawFitnessStudioSection] ${sectionTitle}:`, {
    enabledCards: enabledCards.length,
    enabledCharts: enabledCharts.length,
    kpisAvailable: Object.keys(kpis).length,
    kpisKeys: Object.keys(kpis),
    kpisSample: Object.entries(kpis)
      .slice(0, 10)
      .map(([k, v]) => ({ [k]: v })),
    enabledCardsList: enabledCards,
  });

  // Render KPIs in a grid (max 6 per slide, 2 columns, 3 rows)
  if (enabledCards.length > 0) {
    const cardLabels: Record<string, string> = {
      activeMembers: "Active Members",
      monthlyRevenue: "Monthly Revenue",
      netIncome: "Net Income",
      utilizationRate: "Utilization Rate",
      monthlyChurnRate: "Monthly Churn Rate",
      cashRunway: "Cash Runway",
      newMembers: "New Members",
      churnRate: "Churn Rate",
      avgMemberTenure: "Avg Member Tenure",
      revenuePerMember: "Revenue per Member",
      cancellationRate: "Cancellation Rate",
      noShowRate: "No-show Rate",
      totalClassesHeld: "Total Classes Held",
      avgClassOccupancy: "Avg Class Occupancy",
      capacityUtilization: "Capacity Utilization",
      avgAttendeesPerClass: "Avg Attendees per Class",
      revenuePerClass: "Revenue per Class",
      totalMembers: "Total Members",
      netMemberGrowth: "Net Member Growth",
      engagementRate: "Engagement Rate",
      activeInstructors: "Active Instructors",
      classesTaught: "Classes Taught",
      avgOccupancyPerInstructor: "Avg Occupancy per Instructor",
      revenuePerInstructor: "Revenue per Instructor",
      instructorCancellationRate: "Instructor Cancellation Rate",
      totalRevenue: "Total Revenue",
      totalCosts: "Total Costs",
      grossMargin: "Gross Margin",
      netCashFlow: "Net Cash Flow",
      burnRate: "Burn Rate",
      runway: "Runway",
    };

    const rows: string[][] = [];
    const cardsToShow = enabledCards.slice(0, 6); // Max 6 per slide

    // Create rows with 2 KPIs per row
    for (let i = 0; i < cardsToShow.length; i += 2) {
      const card1 = cardsToShow[i];
      const card2 = cardsToShow[i + 1];

      if (card1) {
        const value = getKpiValue(kpis, card1);
        const label = cardLabels[card1] || card1;
        const formattedValue = formatFitnessStudioKpiValue(
          card1,
          value,
          config
        );
        console.log(`[drawFitnessStudioSection] Card ${card1}:`, {
          cardId: card1,
          rawValue: value,
          formattedValue,
          kpisHasKey: card1 in kpis,
          kpisValue: kpis[card1],
        });
        if (value === null) {
          console.warn(
            `[drawFitnessStudioSection] No value for ${card1}, available keys:`,
            Object.keys(kpis)
          );
        }
        rows.push([label, formattedValue]);
      }

      if (card2) {
        const value = getKpiValue(kpis, card2);
        const label = cardLabels[card2] || card2;
        const formattedValue = formatFitnessStudioKpiValue(
          card2,
          value,
          config
        );
        console.log(`[drawFitnessStudioSection] Card ${card2}:`, {
          cardId: card2,
          rawValue: value,
          formattedValue,
          kpisHasKey: card2 in kpis,
          kpisValue: kpis[card2],
        });
        if (value === null) {
          console.warn(
            `[drawFitnessStudioSection] No value for ${card2}, available keys:`,
            Object.keys(kpis)
          );
        }
        rows.push([label, formattedValue]);
      }
    }

    // Draw professional KPI table
    if (rows.length > 0) {
      autoTable(doc, {
        startY: 85,
        head: [["Metric", "Value"]],
        body: rows,
        theme: "striped",
        margin: { left: col.leftX, right: layout.marginX },
        tableWidth: col.leftW,
        styles: {
          font: theme.font,
          halign: "left",
          fontSize: 10,
          cellPadding: { top: 7, right: 10, bottom: 7, left: 10 },
          lineColor: theme.border,
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [30, 64, 175], // Professional navy
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 11,
          cellPadding: { top: 8, right: 10, bottom: 8, left: 10 },
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251], // Very light gray
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
        },
        columnStyles: {
          0: {
            fontStyle: "bold",
            cellWidth: col.leftW * 0.65,
            textColor: [17, 24, 39],
          },
          1: {
            halign: "right",
            cellWidth: col.leftW * 0.35,
            textColor: [30, 64, 175],
            fontStyle: "bold",
          },
        },
      });
    }
  }

  // Render charts (if any enabled) - professional styling
  if (enabledCharts.length > 0) {
    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    let currentChartY = finalY + 20;
    const chartW = col.leftW;
    // Calculate chart height based on number of charts (max 2 per page, stack vertically)
    const chartsPerPage = 2;
    const chartH = Math.min(
      (layout.pageH - currentChartY - 50) /
        Math.min(enabledCharts.length, chartsPerPage),
      250
    );

    // Render all enabled charts
    if (fitnessStudioData?.fromDate && fitnessStudioData?.toDate) {
      for (let i = 0; i < enabledCharts.length; i++) {
        const chartType = enabledCharts[i];

        // Check if we need a new page (every 2 charts)
        if (i > 0 && i % chartsPerPage === 0) {
          doc.addPage();
          drawHeader(doc, config, slideNumber);
          // Redraw section header
          doc.setFont(theme.fontBold, "bold");
          doc.setFontSize(18);
          doc.setTextColor(theme.text);
          doc.text(`${slideNumber}. ${sectionTitle}`, col.leftX, 60);
          doc.setDrawColor(30, 64, 175);
          doc.setLineWidth(2);
          const textWidth = doc.getTextWidth(`${slideNumber}. ${sectionTitle}`);
          doc.line(col.leftX, 65, col.leftX + textWidth, 65);
          currentChartY = 85;
        }

        // Chart title above chart
        doc.setFont(theme.fontBold, "bold");
        doc.setFontSize(11);
        doc.setTextColor(theme.text);
        const chartTitle = chartType
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (str) => str.toUpperCase())
          .trim();
        doc.text(chartTitle, col.leftX, currentChartY - 5);

        // Chart container - clean border
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(theme.border);
        doc.setLineWidth(0.5);
        doc.rect(col.leftX, currentChartY, chartW, chartH, "FD");

        try {
          const chartData = await fetchFitnessStudioChart(
            chartType,
            fitnessStudioData.fromDate,
            fitnessStudioData.toDate
          );

          // If chartData is null, it means the chart type is not yet implemented
          if (chartData === null) {
            drawChartPlaceholder(
              doc,
              col.leftX + 5,
              currentChartY + 5,
              chartW - 10,
              chartH - 10,
              `Chart "${chartTitle}" coming soon`
            );
          } else if (chartData && chartData.length > 0) {
            // Generate chart image using QuickChart
            const { fetchChartBase64 } = await import("@/lib/chart-generator");
            const chartConfig = createFitnessStudioChartConfig(
              chartType,
              chartData
            );
            if (chartConfig) {
              const chartImage = await fetchChartBase64(chartConfig);

              if (chartImage) {
                // Add chart image with proper padding
                doc.addImage(
                  chartImage,
                  "PNG",
                  col.leftX + 5,
                  currentChartY + 5,
                  chartW - 10,
                  chartH - 10
                );
              } else {
                drawChartPlaceholder(
                  doc,
                  col.leftX + 5,
                  currentChartY + 5,
                  chartW - 10,
                  chartH - 10,
                  `Chart image generation failed`
                );
              }
            } else {
              drawChartPlaceholder(
                doc,
                col.leftX + 5,
                currentChartY + 5,
                chartW - 10,
                chartH - 10,
                `Unable to generate chart config`
              );
            }
          } else {
            drawChartPlaceholder(
              doc,
              col.leftX + 5,
              currentChartY + 5,
              chartW - 10,
              chartH - 10,
              `No data available`
            );
          }
        } catch (error) {
          console.error(
            `[drawFitnessStudioSection] Error rendering chart ${chartType}:`,
            error
          );
          drawChartPlaceholder(
            doc,
            col.leftX + 5,
            currentChartY + 5,
            chartW - 10,
            chartH - 10,
            "Chart unavailable"
          );
        }

        // Move to next chart position
        currentChartY += chartH + 20;
      }
    } else {
      // No date range available, show placeholder
      doc.setFont(theme.font, "normal");
      doc.setFontSize(11);
      doc.setTextColor(theme.lightText);
      doc.text(
        `Charts: ${enabledCharts.join(", ")}`,
        col.leftX + 10,
        currentChartY + chartH / 2
      );
    }
  }

  // Right panel with insights
  const insightKey = getInsightKeyForSection(sectionTitle);
  const sectionInsights = insights?.[insightKey as keyof ReportInsights] as
    | string[]
    | undefined;

  // Calculate panel position - place it on the right side
  const panelY = 85; // Start after header
  const panelH = layout.pageH - panelY - 50; // Fill available space

  // Use shorter title for long section names to fit in panel
  const shortTitle =
    sectionTitle.length > 20
      ? "Key Insights"
      : `${sectionTitle} – Key Insights`;

  drawCommentPanel(
    doc,
    col.rightX,
    panelY,
    col.rightW,
    panelH,
    shortTitle,
    sectionInsights
  );
}

/**
 * Draw a restaurant section with actual data
 * Similar structure to drawFitnessStudioSection but for restaurant data
 */
async function drawRestaurantSection(
  doc: jsPDF,
  sectionTitle: string,
  slideNumber: number,
  section: any,
  data: ReportData,
  config?: ReportConfig,
  restaurantData?: any,
  insights?: ReportInsights
): Promise<void> {
  // Professional section header
  const headerY = 60;

  // Section number and title
  doc.setFont(theme.fontBold, "bold");
  doc.setFontSize(18);
  doc.setTextColor(theme.text);
  doc.text(`${slideNumber}. ${sectionTitle}`, col.leftX, headerY);

  // Underline
  doc.setDrawColor(30, 64, 175); // Navy blue
  doc.setLineWidth(2);
  const textWidth = doc.getTextWidth(`${slideNumber}. ${sectionTitle}`);
  doc.line(col.leftX, headerY + 5, col.leftX + textWidth, headerY + 5);

  // Get enabled cards
  const enabledCards = Object.entries(section.cards || {})
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);

  // Get enabled charts
  const enabledCharts = Object.entries(section.charts || {})
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);

  const kpis = restaurantData?.kpis || {};

  // Debug logging
  console.log(`[drawRestaurantSection] ${sectionTitle}:`, {
    enabledCards: enabledCards.length,
    enabledCharts: enabledCharts.length,
    kpisAvailable: Object.keys(kpis).length,
    kpisKeys: Object.keys(kpis),
  });

  // Render KPIs in a grid (max 6 per slide, 2 columns, 3 rows)
  if (enabledCards.length > 0) {
    const cardLabels: Record<string, string> = {
      // Restaurant Overview
      totalRevenue: "Total Revenue",
      covers: "Covers",
      averageTicketSize: "Average Ticket Size",
      primeCostPercent: "Prime Cost %",
      totalCOGS: "Total COGS",
      totalLabor: "Total Labor",
      primeCost: "Prime Cost",
      // Operations
      tableUtilization: "Table Utilization",
      reservationsEffectiveness: "Reservations Effectiveness",
      // Cash Flow
      netCashFlow: "Net Cash Flow",
      burnRate: "Burn Rate",
      cashBalance: "Cash Balance",
      cashRunway: "Cash Runway",
    };

    const rows: string[][] = [];
    const cardsToShow = enabledCards.slice(0, 6); // Max 6 per slide

    // Create rows with 2 KPIs per row
    for (let i = 0; i < cardsToShow.length; i += 2) {
      const card1 = cardsToShow[i];
      const card2 = cardsToShow[i + 1];

      if (card1) {
        const value = getRestaurantKpiValue(kpis, card1);
        const label = cardLabels[card1] || card1;
        const formattedValue = formatRestaurantKpiValue(card1, value, config);
        rows.push([label, formattedValue]);
      }

      if (card2) {
        const value = getRestaurantKpiValue(kpis, card2);
        const label = cardLabels[card2] || card2;
        const formattedValue = formatRestaurantKpiValue(card2, value, config);
        rows.push([label, formattedValue]);
      }
    }

    // Draw professional KPI table
    if (rows.length > 0) {
      autoTable(doc, {
        startY: 85,
        head: [["Metric", "Value"]],
        body: rows,
        theme: "striped",
        margin: { left: col.leftX, right: layout.marginX },
        tableWidth: col.leftW,
        styles: {
          font: theme.font,
          halign: "left",
          fontSize: 10,
          cellPadding: { top: 7, right: 10, bottom: 7, left: 10 },
          lineColor: theme.border,
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [30, 64, 175],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 11,
          cellPadding: { top: 8, right: 10, bottom: 8, left: 10 },
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251],
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
        },
        columnStyles: {
          0: {
            fontStyle: "bold",
            cellWidth: col.leftW * 0.65,
            textColor: [17, 24, 39],
          },
          1: {
            halign: "right",
            cellWidth: col.leftW * 0.35,
            textColor: [30, 64, 175],
            fontStyle: "bold",
          },
        },
      });
    }
  }

  // Render charts (if any enabled) - professional styling
  if (enabledCharts.length > 0) {
    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    let currentChartY = finalY + 20;
    const chartW = col.leftW;
    // Calculate chart height based on number of charts (max 2 per page, stack vertically)
    const chartsPerPage = 2;
    const chartH = Math.min(
      (layout.pageH - currentChartY - 50) /
        Math.min(enabledCharts.length, chartsPerPage),
      250
    );

    // Import restaurant chart fetching
    const { fetchRestaurantChart } =
      await import("@/lib/restaurant-report-data");

    // Render all enabled charts
    if (restaurantData?.fromDate && restaurantData?.toDate) {
      for (let i = 0; i < enabledCharts.length; i++) {
        const chartType = enabledCharts[i];

        // Check if we need a new page (every 2 charts)
        if (i > 0 && i % chartsPerPage === 0) {
          doc.addPage();
          drawHeader(doc, config, slideNumber);
          // Redraw section header
          doc.setFont(theme.fontBold, "bold");
          doc.setFontSize(18);
          doc.setTextColor(theme.text);
          doc.text(`${slideNumber}. ${sectionTitle}`, col.leftX, 60);
          doc.setDrawColor(30, 64, 175);
          doc.setLineWidth(2);
          const textWidth = doc.getTextWidth(`${slideNumber}. ${sectionTitle}`);
          doc.line(col.leftX, 65, col.leftX + textWidth, 65);
          currentChartY = 85;
        }

        // Chart title above chart
        doc.setFont(theme.fontBold, "bold");
        doc.setFontSize(11);
        doc.setTextColor(theme.text);
        const chartTitle = chartType
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (str) => str.toUpperCase())
          .trim();
        doc.text(chartTitle, col.leftX, currentChartY - 5);

        // Chart container - clean border
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(theme.border);
        doc.setLineWidth(0.5);
        doc.rect(col.leftX, currentChartY, chartW, chartH, "FD");

        try {
          const chartData = await fetchRestaurantChart(
            chartType,
            restaurantData.fromDate,
            restaurantData.toDate
          );

          // If chartData is null, it means the chart type is not yet implemented
          if (chartData === null) {
            drawChartPlaceholder(
              doc,
              col.leftX + 5,
              currentChartY + 5,
              chartW - 10,
              chartH - 10,
              `Chart "${chartTitle}" coming soon`
            );
          } else if (chartData && chartData.length > 0) {
            // Generate chart image using QuickChart
            const { fetchChartBase64 } = await import("@/lib/chart-generator");
            const chartConfig = createRestaurantChartConfig(
              chartType,
              chartData
            );
            if (chartConfig) {
              const chartImage = await fetchChartBase64(chartConfig);

              if (chartImage) {
                // Add chart image with proper padding
                doc.addImage(
                  chartImage,
                  "PNG",
                  col.leftX + 5,
                  currentChartY + 5,
                  chartW - 10,
                  chartH - 10
                );
              } else {
                drawChartPlaceholder(
                  doc,
                  col.leftX + 5,
                  currentChartY + 5,
                  chartW - 10,
                  chartH - 10,
                  `Chart image generation failed`
                );
              }
            } else {
              drawChartPlaceholder(
                doc,
                col.leftX + 5,
                currentChartY + 5,
                chartW - 10,
                chartH - 10,
                `Unable to generate chart config`
              );
            }
          } else {
            drawChartPlaceholder(
              doc,
              col.leftX + 5,
              currentChartY + 5,
              chartW - 10,
              chartH - 10,
              `No data available`
            );
          }
        } catch (error) {
          console.error(
            `[drawRestaurantSection] Error rendering chart ${chartType}:`,
            error
          );
          drawChartPlaceholder(
            doc,
            col.leftX + 5,
            currentChartY + 5,
            chartW - 10,
            chartH - 10,
            "Chart unavailable"
          );
        }

        // Move to next chart position
        currentChartY += chartH + 20;
      }
    } else {
      // No date range available, show placeholder
      doc.setFont(theme.font, "normal");
      doc.setFontSize(11);
      doc.setTextColor(theme.lightText);
      doc.text(
        `Charts: ${enabledCharts.join(", ")}`,
        col.leftX + 10,
        currentChartY + chartH / 2
      );
    }
  }

  // Right panel with insights
  const insightKey = getInsightKeyForSection(sectionTitle);
  const sectionInsights = insights?.[insightKey as keyof ReportInsights] as
    | string[]
    | undefined;

  // Calculate panel position - place it on the right side
  const panelY = 85; // Start after header
  const panelH = layout.pageH - panelY - 50; // Fill available space

  // Use shorter title for long section names to fit in panel
  const shortTitle =
    sectionTitle.length > 20
      ? "Key Insights"
      : `${sectionTitle} – Key Insights`;

  drawCommentPanel(
    doc,
    col.rightX,
    panelY,
    col.rightW,
    panelH,
    shortTitle,
    sectionInsights
  );
}

/**
 * Map section title to insight key
 */
function getInsightKeyForSection(sectionTitle: string): keyof ReportInsights {
  const mapping: Record<string, keyof ReportInsights> = {
    "Executive Overview": "overview",
    "Studio Performance": "overview",
    "Classes & Utilization": "overview",
    Members: "overview",
    Instructors: "overview",
    Financials: "financial",
    "Cash Flow": "cashflow",
    "Revenue & Menu Performance": "financial",
    Operations: "operations",
  };
  return mapping[sectionTitle] || "overview";
}

/**
 * Get KPI value for restaurant metrics
 */
function getRestaurantKpiValue(
  kpis: any,
  cardId: string
): number | string | null {
  const mapping: Record<string, string | string[]> = {
    totalRevenue: ["totalRevenue", "revenue"],
    covers: "covers",
    averageTicketSize: ["averageTicketSize", "avgTicketSize"],
    primeCostPercent: ["primeCostPercent", "primeCost"],
    totalCOGS: ["totalCOGS", "cogs"],
    totalLabor: ["totalLabor", "labor"],
    primeCost: "primeCost",
    tableUtilization: ["tableUtilization", "utilization"],
    reservationsEffectiveness: ["reservationsEffectiveness", "reservations"],
    netCashFlow: ["netCashFlow", "cashFlow"],
    burnRate: "burnRate",
    cashBalance: ["cashBalance", "balance"],
    cashRunway: ["cashRunway", "runway"],
  };

  const keyOrKeys = mapping[cardId];
  if (!keyOrKeys) {
    return null;
  }

  const keysToTry = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

  for (const key of keysToTry) {
    const value = kpis?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return typeof value === "number" ? value : String(value);
    }
  }

  return null;
}

/**
 * Format restaurant KPI value for display
 */
function formatRestaurantKpiValue(
  cardId: string,
  value: number | string | null,
  config?: ReportConfig
): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  const currency = config?.currency || "USD";
  const numberFormat = config?.numberFormat || "en-US";

  // Percentage KPIs
  if (
    cardId.includes("Percent") ||
    cardId.includes("percent") ||
    cardId === "primeCostPercent"
  ) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (isNaN(numValue)) return "N/A";
    return `${numValue.toFixed(1)}%`;
  }

  // Currency KPIs
  if (
    cardId.includes("Revenue") ||
    cardId.includes("Cost") ||
    cardId.includes("Labor") ||
    cardId.includes("Cash") ||
    cardId.includes("Balance") ||
    cardId.includes("Ticket") ||
    cardId === "netCashFlow" ||
    cardId === "burnRate" ||
    cardId === "cashBalance" ||
    cardId === "totalRevenue" ||
    cardId === "totalCOGS" ||
    cardId === "totalLabor" ||
    cardId === "primeCost" ||
    cardId === "averageTicketSize"
  ) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (isNaN(numValue)) return "N/A";
    return formatCurrencyUtil(numValue, currency, numberFormat);
  }

  // Number KPIs
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "N/A";
  return formatNumberUtil(numValue, numberFormat);
}

/* ---------------- Header ---------------- */
function drawHeader(
  doc: jsPDF,
  config?: ReportConfig,
  pageNumber?: number
): void {
  const company = config?.company || "Milton";
  const period = config?.periodLabel || "Current Month";

  // Top accent line
  doc.setFillColor(30, 64, 175); // Navy blue
  doc.rect(0, 0, layout.pageW, 3, "F");

  // Company name - left aligned
  doc.setFont(theme.fontBold, "bold");
  doc.setFontSize(14);
  doc.setTextColor(theme.text);
  doc.text(company, theme.marginX, 25);

  // Period - right aligned
  doc.setFont(theme.font, "normal");
  doc.setFontSize(10);
  doc.setTextColor(theme.lightText);
  doc.text(period, layout.pageW - theme.marginX, 25, { align: "right" });

  // Bottom border
  doc.setDrawColor(theme.border);
  doc.setLineWidth(0.5);
  doc.line(theme.marginX, 35, layout.pageW - theme.marginX, 35);

  // Page number in footer
  if (pageNumber) {
    doc.setFont(theme.font, "normal");
    doc.setFontSize(9);
    doc.setTextColor(theme.lighterText);
    doc.text(`Page ${pageNumber}`, layout.pageW / 2, layout.pageH - 20, {
      align: "center",
    });
  }
}

/* ---------------- PAGE 1: Overview ---------------- */
function drawOverviewPage(
  doc: jsPDF,
  data: ReportData,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  config?: ReportConfig
): void {
  doc.setFont(theme.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(theme.text);
  doc.text("1. Overview & Performance", col.leftX, 110);

  const kpis = data.kpis;
  const rows = [
    ["Revenue", formatCurrency(kpis.revenue, config)],
    ["Expenses", formatCurrency(kpis.expenses, config)],
    ["Net Income", formatCurrency(kpis.netIncome, config)],
    ["Burn Rate (per month)", formatCurrency(kpis.burnRate, config)],
    ["Cash Runway (months)", kpis.cashRunway?.toString() || "0"],
  ];

  autoTable(doc, {
    startY: 130,
    head: [["Metric", "Value"]],
    body: rows,
    theme: "striped",
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: {
      font: theme.font,
      halign: "left",
      fontSize: 11,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: "#FFFFFF",
      fontStyle: "bold",
      fontSize: 12,
    },
    alternateRowStyles: {
      fillColor: "#F5F7FA",
    },
  });

  // Chart area with background
  const chartY = 280;
  const chartW = col.leftW - 20;
  const chartH = 240;

  doc.setFillColor(248, 248, 248);
  doc.rect(col.leftX, chartY, chartW, chartH, "F");

  if (chartImages?.overview) {
    try {
      doc.addImage(
        chartImages.overview,
        "PNG",
        col.leftX,
        chartY,
        chartW,
        chartH
      );
    } catch {
      drawChartPlaceholder(
        doc,
        col.leftX,
        chartY,
        chartW,
        chartH,
        "Overview Chart (Image Load Failed)"
      );
    }
  } else {
    drawChartPlaceholder(
      doc,
      col.leftX,
      chartY,
      chartW,
      chartH,
      "Overview Charts"
    );
  }

  // Right panel with insights
  drawCommentPanel(
    doc,
    col.rightX,
    110,
    col.rightW,
    410,
    "Overview – Key Insights",
    insights?.overview
  );
}

/* ---------------- PAGE 2: Financial ---------------- */
function drawFinancialPage(
  doc: jsPDF,
  data: ReportData,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  config?: ReportConfig
): void {
  doc.setFont(theme.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(theme.text);
  doc.text("2. Financial Analysis", col.leftX, 110);

  const variance = data.budgetVariance || [];
  const body = variance.map((v) => [
    v.label,
    formatCurrency(v.actual, config),
    formatCurrency(v.planned, config),
    formatCurrency(v.variance, config),
    `${v.variancePct.toFixed(1)}%`,
  ]);

  autoTable(doc, {
    startY: 130,
    head: [["Category", "Actual", "Planned", "Variance", "Δ %"]],
    body,
    theme: "striped",
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: {
      font: theme.font,
      halign: "right",
      fontSize: 11,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: "#FFFFFF",
      fontStyle: "bold",
      fontSize: 12,
    },
    alternateRowStyles: {
      fillColor: "#F5F7FA",
    },
    columnStyles: {
      0: { halign: "left" },
    },
  });

  // Chart area with background
  const finalY = (doc as any).lastAutoTable?.finalY || 240;
  const chartY = finalY + 20;
  const chartW = col.leftW - 20;
  const chartH = 200;

  doc.setFillColor(248, 248, 248);
  doc.rect(col.leftX, chartY, chartW, chartH, "F");

  if (chartImages?.financial) {
    try {
      doc.addImage(
        chartImages.financial,
        "PNG",
        col.leftX,
        chartY,
        chartW,
        chartH
      );
    } catch {
      drawChartPlaceholder(
        doc,
        col.leftX,
        chartY,
        chartW,
        chartH,
        "Financial Chart (Image Load Failed)"
      );
    }
  } else {
    drawChartPlaceholder(
      doc,
      col.leftX,
      chartY,
      chartW,
      chartH,
      "Revenue vs Expense"
    );
  }

  // Right panel with insights
  drawCommentPanel(
    doc,
    col.rightX,
    110,
    col.rightW,
    410,
    "Financial – Variance & Notes",
    insights?.financial
  );
}

/* ---------------- PAGE 3: Pipeline ---------------- */
function drawPipelinePage(
  doc: jsPDF,
  data: ReportData,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  config?: ReportConfig
): void {
  doc.setFont(theme.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(theme.text);
  doc.text("3. Sales Pipeline", col.leftX, 110);

  const rows = [
    ["Total Pipeline Value", formatCurrency(data.kpis.pipelineValue, config)],
    ["Open Deals", data.kpis.openDeals?.toString() || "0"],
  ];

  autoTable(doc, {
    startY: 130,
    head: [["Metric", "Value"]],
    body: rows,
    theme: "striped",
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: {
      font: theme.font,
      halign: "left",
      fontSize: 11,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: "#FFFFFF",
      fontStyle: "bold",
      fontSize: 12,
    },
    alternateRowStyles: {
      fillColor: "#F5F7FA",
    },
  });

  // Chart area with background
  const chartY = 230;
  const chartW = col.leftW - 20;
  const chartH = 290;

  doc.setFillColor(248, 248, 248);
  doc.rect(col.leftX, chartY, chartW, chartH, "F");

  if (chartImages?.pipeline) {
    try {
      doc.addImage(
        chartImages.pipeline,
        "PNG",
        col.leftX,
        chartY,
        chartW,
        chartH
      );
    } catch {
      drawChartPlaceholder(
        doc,
        col.leftX,
        chartY,
        chartW,
        chartH,
        "Pipeline Chart (Image Load Failed)"
      );
    }
  } else {
    drawChartPlaceholder(
      doc,
      col.leftX,
      chartY,
      chartW,
      chartH,
      "Pipeline by Stage"
    );
  }

  // Right panel with insights
  drawCommentPanel(
    doc,
    col.rightX,
    110,
    col.rightW,
    410,
    "Pipeline – Highlights",
    insights?.pipeline
  );
}

/* ---------------- PAGE 4: Cash Flow ---------------- */
function drawCashFlowPage(
  doc: jsPDF,
  data: ReportData,
  insights?: ReportInsights,
  chartImages?: ChartImages,
  config?: ReportConfig
): void {
  doc.setFont(theme.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(theme.text);
  doc.text("4. Cash Flow Analysis", col.leftX, 110);

  const rows = [
    ["Burn Rate (per month)", formatCurrency(data.kpis.burnRate, config)],
    ["Cash Runway (months)", data.kpis.cashRunway?.toString() || "0"],
    ["Net Income", formatCurrency(data.kpis.netIncome, config)],
  ];

  autoTable(doc, {
    startY: 130,
    head: [["Metric", "Value"]],
    body: rows,
    theme: "striped",
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: {
      font: theme.font,
      halign: "left",
      fontSize: 11,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: "#FFFFFF",
      fontStyle: "bold",
      fontSize: 12,
    },
    alternateRowStyles: {
      fillColor: "#F5F7FA",
    },
  });

  // Chart area with background
  const chartY = 260;
  const chartW = col.leftW - 20;
  const chartH = 260;

  doc.setFillColor(248, 248, 248);
  doc.rect(col.leftX, chartY, chartW, chartH, "F");

  if (chartImages?.cashflow) {
    try {
      doc.addImage(
        chartImages.cashflow,
        "PNG",
        col.leftX,
        chartY,
        chartW,
        chartH
      );
    } catch {
      drawChartPlaceholder(
        doc,
        col.leftX,
        chartY,
        chartW,
        chartH,
        "Cash Flow Chart (Image Load Failed)"
      );
    }
  } else {
    drawChartPlaceholder(
      doc,
      col.leftX,
      chartY,
      chartW,
      chartH,
      "Cash Flow Trend"
    );
  }

  // Right panel with insights
  drawCommentPanel(
    doc,
    col.rightX,
    110,
    col.rightW,
    410,
    "Cash Flow – Highlights",
    insights?.cashflow
  );
}

/* ---------------- Helpers ---------------- */
function drawCommentPanel(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  bullets: string[] | undefined
): void {
  // Background fill
  doc.setDrawColor(230, 230, 230);
  doc.setFillColor(248, 248, 248);
  doc.rect(x, y, w, h, "F");

  // Border
  doc.setDrawColor(210, 210, 210);
  doc.rect(x, y, w, h);

  // Title - wrap if too long
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor("#222222");
  const titleMaxWidth = w - 28;
  const titleLines = doc.splitTextToSize(title, titleMaxWidth);
  doc.text(titleLines, x + 14, y + 22);

  // Bullets
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(11);
  const bodyY = y + 22 + titleLines.length * 14 + 8; // Adjust based on title height
  const maxWidth = w - 28;
  let cursor = bodyY;
  const items = (
    bullets && bullets.length
      ? bullets
      : ["No material variance for this section."]
  ).slice(0, 4);

  for (const b of items) {
    // Truncate long insights to max 120 characters per bullet
    const truncatedBullet = b.length > 120 ? b.substring(0, 117) + "..." : b;
    const lines = doc.splitTextToSize("• " + truncatedBullet, maxWidth);
    doc.text(lines, x + 14, cursor);
    cursor += lines.length * 14 + 6;
    if (cursor > y + h - 20) break;
  }
}

function drawChartPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
): void {
  // Light background fill
  doc.setFillColor(245, 247, 250);
  doc.rect(x, y, w, h, "F");

  // Border
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(1);
  doc.rect(x, y, w, h);

  // Label
  doc.setFont(theme.font, "normal");
  doc.setFontSize(11);
  doc.setTextColor("#555555");
  doc.text(label, x + w / 2, y + h / 2, { align: "center" });
}

/**
 * Create chart config for fitness studio charts
 * Handles different data structures for different chart types
 * chartType is the report chart ID (e.g., "membersOverTime", "utilizationHeatmap")
 */
function createFitnessStudioChartConfig(
  chartType: string,
  chartData: any[]
): any {
  if (!chartData || chartData.length === 0) {
    return null;
  }

  // Handle utilization heatmap - special structure: { weekday_iso, hour_of_day, utilization }
  if (chartType === "utilizationHeatmap" || chartType.includes("heatmap")) {
    // Heatmap data structure: { weekday_iso, hour_of_day, utilization }
    // Convert to a format that can be displayed as a bar chart grouped by weekday
    const weekdayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6am to 10pm

    // Group by hour, then by weekday
    const hourLabels = hours.map((h) =>
      h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`
    );
    const datasets = [];

    // Create a dataset for each weekday
    for (let weekday = 1; weekday <= 7; weekday++) {
      const weekdayData = hours.map((hour) => {
        const dataPoint = chartData.find(
          (d: any) => d.weekday_iso === weekday && d.hour_of_day === hour
        );
        return dataPoint ? dataPoint.utilization : 0;
      });

      if (weekdayData.some((v) => v > 0)) {
        datasets.push({
          label: weekdayNames[weekday],
          data: weekdayData,
          backgroundColor: getWeekdayColor(weekday),
        });
      }
    }

    if (datasets.length === 0) {
      return null;
    }

    return {
      type: "bar",
      data: {
        labels: hourLabels,
        datasets,
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Utilization by Day & Hour" },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Utilization %" },
          },
          x: { title: { display: true, text: "Hour of Day" } },
        },
      },
    };
  }

  // Handle new-vs-churned - has new_members and churned_members
  if (chartType === "newVsChurned" || chartType === "membersNewVsChurned") {
    // Format labels based on whether they're daily or monthly
    const labels = chartData.map((d) => {
      const period = d.period || d.month || "";
      if (period.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Daily format: convert to "Jan 15" format
        const date = new Date(period);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
      } else if (period.match(/^\d{4}-\d{2}$/)) {
        // Monthly format: convert to "Jan 2024" format
        const [year, month] = period.split("-");
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return period;
    });
    const newMembers = chartData.map((d) => d.new_members || 0);
    const churnedMembers = chartData.map((d) => d.churned_members || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "New Members",
            data: newMembers,
            backgroundColor: "#10B981",
          },
          {
            label: "Churned Members",
            data: churnedMembers,
            backgroundColor: "#EF4444",
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: { beginAtZero: true },
          x: { stacked: false },
        },
      },
    };
  }

  // Handle revenue trend - currently mapped to revenue-per-member API
  // The API returns { period, value } where value is revenue per member
  if (chartType === "revenueTrend") {
    // Format labels based on whether they're daily or monthly
    const labels = chartData.map((d) => {
      const period = d.period || d.month || "";
      if (period.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Daily format: convert to "Jan 15" format
        const date = new Date(period);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
      } else if (period.match(/^\d{4}-\d{2}$/)) {
        // Monthly format: convert to "Jan 2024" format
        const [year, month] = period.split("-");
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return period;
    });
    // Note: This is actually revenue per member, not total revenue
    // TODO: Create a dedicated revenue trend endpoint
    const revenue = chartData.map((d) => d.value || 0);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue per Member",
            data: revenue,
            borderColor: "#0A84FF",
            backgroundColor: "rgba(10, 132, 255, 0.1)",
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }

  // Handle revenue per member trend
  if (chartType === "revenuePerMemberTrend") {
    // Format labels based on whether they're daily or monthly
    const labels = chartData.map((d) => {
      const period = d.period || d.month || "";
      if (period.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Daily format: convert to "Jan 15" format
        const date = new Date(period);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
      } else if (period.match(/^\d{4}-\d{2}$/)) {
        // Monthly format: convert to "Jan 2024" format
        const [year, month] = period.split("-");
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return period;
    });
    const revenuePerMember = chartData.map((d) => d.value || 0);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue per Member",
            data: revenuePerMember,
            borderColor: "#10B981",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }

  // Handle occupancy trend
  if (chartType === "occupancyTrend") {
    // Format labels based on whether they're daily or monthly
    const labels = chartData.map((d) => {
      const period = d.period || d.month || "";
      if (period.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Daily format: convert to "Jan 15" format
        const date = new Date(period);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
      } else if (period.match(/^\d{4}-\d{2}$/)) {
        // Monthly format: convert to "Jan 2024" format
        const [year, month] = period.split("-");
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return period;
    });
    const occupancy = chartData.map((d) => d.value || d.occupancy || 0);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Average Class Occupancy (%)",
            data: occupancy,
            borderColor: "#8B5CF6",
            backgroundColor: "rgba(139, 92, 246, 0.1)",
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Occupancy %" },
          },
        },
      },
    };
  }

  // Handle class outcomes (stacked bar chart)
  if (chartType === "classOutcomes") {
    const labels = chartData.map((d) => d.status || "");
    const values = chartData.map((d) => d.value || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Count",
            data: values,
            backgroundColor: [
              "#3B82F6", // Blue for Booked
              "#10B981", // Green for Attended
              "#EF4444", // Red for Cancelled
              "#F59E0B", // Orange for No Show
            ],
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Class Outcomes" },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Count" } },
          x: { title: { display: true, text: "Status" } },
        },
      },
    };
  }

  // Handle top 10 classes by occupancy (horizontal bar chart)
  if (chartType === "top10ClassesByOccupancy") {
    const labels = chartData.map((d) => {
      const name = d.class_name || d.className || "Unknown";
      // Truncate long names
      return name.length > 20 ? name.substring(0, 20) + "..." : name;
    });
    const occupancy = chartData.map((d) => d.occupancy || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Occupancy %",
            data: occupancy,
            backgroundColor: "#8B5CF6",
          },
        ],
      },
      options: {
        indexAxis: "y", // Horizontal bar chart
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Top 10 Classes by Occupancy" },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Occupancy %" },
          },
          y: { title: { display: true, text: "Class" } },
        },
      },
    };
  }

  // Handle top 10 classes by revenue (horizontal bar chart)
  if (chartType === "top10ClassesByRevenue") {
    const labels = chartData.map((d) => {
      const name = d.class_name || d.className || "Unknown";
      // Truncate long names
      return name.length > 20 ? name.substring(0, 20) + "..." : name;
    });
    const revenue = chartData.map((d) => d.revenue || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue",
            data: revenue,
            backgroundColor: "#10B981",
          },
        ],
      },
      options: {
        indexAxis: "y", // Horizontal bar chart
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Top 10 Classes by Revenue" },
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: "Revenue ($)" },
          },
          y: { title: { display: true, text: "Class" } },
        },
      },
    };
  }

  // Default handling for period-based charts (member-count, revenue-per-member, etc.)
  // Format labels based on whether they're daily or monthly
  const labels = chartData.map((d) => {
    if (d.period) {
      // Check if it's a daily date (YYYY-MM-DD) or monthly (YYYY-MM)
      const period = d.period;
      if (period.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Daily format: convert to "Jan 15" format
        const date = new Date(period);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
      } else if (period.match(/^\d{4}-\d{2}$/)) {
        // Monthly format: convert to "Jan 2024" format
        const [year, month] = period.split("-");
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return period;
    }
    if (d.month) return d.month;
    return "";
  });
  const data = chartData.map((d) => d.value || d.count || 0);

  // Determine chart type based on chartType string
  if (
    chartType.includes("line") ||
    chartType.includes("trend") ||
    chartType.includes("OverTime")
  ) {
    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: chartType.replace(/([A-Z])/g, " $1").trim(),
            data,
            borderColor: "#0A84FF",
            backgroundColor: "rgba(10, 132, 255, 0.1)",
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } },
      },
    };
  } else if (chartType.includes("bar")) {
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: chartType.replace(/([A-Z])/g, " $1").trim(),
            backgroundColor: "#0A84FF",
            data,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  } else {
    // Default to line chart
    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: chartType.replace(/([A-Z])/g, " $1").trim(),
            data,
            borderColor: "#0A84FF",
            backgroundColor: "rgba(10, 132, 255, 0.1)",
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }
}

/**
 * Create chart config for restaurant charts
 * Handles different data structures for different chart types
 */
function createRestaurantChartConfig(chartType: string, chartData: any[]): any {
  if (!chartData || chartData.length === 0) {
    return null;
  }

  // Sales Trends (line chart)
  if (chartType === "salesTrend" || chartType === "salesTrends") {
    const labels = chartData.map((d) => {
      const date = d.date || "";
      if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const dateObj = new Date(date);
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}`;
      }
      return date;
    });
    const revenue = chartData.map((d) => d.revenue || 0);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue",
            data: revenue,
            borderColor: "#0A84FF",
            backgroundColor: "rgba(10, 132, 255, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Sales Trends" },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function (value: any) {
                return "$" + value.toLocaleString();
              },
            },
          },
        },
      },
    };
  }

  // Category Breakdown (pie/donut chart)
  if (chartType === "categoryBreakdown") {
    const labels = chartData.map((d) => d.category || "");
    const data = chartData.map((d) => d.revenue || 0);

    return {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: [
              "#0088FE",
              "#00C49F",
              "#FFBB28",
              "#FF8042",
              "#8884d8",
              "#82CA9D",
              "#FFC658",
              "#FF7C7C",
            ],
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Revenue by Category" },
          tooltip: {
            callbacks: {
              label: function (context: any) {
                const label = context.label || "";
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce(
                  (a: number, b: number) => a + b,
                  0
                );
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: $${value.toLocaleString()} (${percentage}%)`;
              },
            },
          },
        },
      },
    };
  }

  // Channel Breakdown (bar chart)
  if (chartType === "channelBreakdown") {
    const labels = chartData.map((d) => d.channel || "");
    const data = chartData.map((d) => d.revenue || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue",
            data,
            backgroundColor: "#0088FE",
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Revenue by Channel" },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function (value: any) {
                return "$" + value.toLocaleString();
              },
            },
          },
        },
      },
    };
  }

  // Covers by Day (bar chart)
  if (chartType === "coversByDay") {
    const labels = chartData.map((d) => d.day || "");
    const covers = chartData.map((d) => d.covers || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Covers",
            data: covers,
            backgroundColor: "#0088FE",
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Covers by Day of Week" },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  }

  // Covers by Hour (line chart)
  if (chartType === "coversByHour") {
    const labels = chartData.map((d) => d.hourLabel || "");
    const covers = chartData.map((d) => d.covers || 0);

    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Covers",
            data: covers,
            borderColor: "#0088FE",
            backgroundColor: "rgba(0, 136, 254, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Covers by Hour" },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  }

  // Cash Flow Overview (bar chart)
  if (chartType === "cashFlowOverview") {
    const labels = chartData.map((d) => d.category || "");
    const amounts = chartData.map((d) => d.amount || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Amount",
            data: amounts,
            backgroundColor: chartData.map((d, i) => {
              if (d.category === "Net Cash Flow") {
                return d.amount >= 0 ? "#00C49F" : "#FF8042";
              }
              return d.category === "Inflows" ? "#00C49F" : "#FF8042";
            }),
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Cash Flow Overview" },
        },
        scales: {
          y: {
            ticks: {
              callback: function (value: any) {
                return "$" + value.toLocaleString();
              },
            },
          },
        },
      },
    };
  }

  // Top/Bottom Items - for now, show as placeholder (table format would be better)
  if (chartType === "topItems" || chartType === "bottomItems") {
    // Convert to bar chart showing top 10 items by revenue
    const labels = chartData
      .slice(0, 10)
      .map((d) => (d.name || "").substring(0, 20));
    const revenue = chartData.slice(0, 10).map((d) => d.revenue || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue",
            data: revenue,
            backgroundColor: "#0088FE",
          },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { position: "bottom" },
          title: {
            display: true,
            text:
              chartType === "topItems"
                ? "Top Performing Items"
                : "Bottom Performing Items",
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (value: any) {
                return "$" + value.toLocaleString();
              },
            },
          },
        },
      },
    };
  }

  // Peak Times - show as bar chart
  if (chartType === "peakTimes") {
    const labels = chartData.map((d) => d.hourLabel || "");
    const covers = chartData.map((d) => d.covers || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Covers",
            data: covers,
            backgroundColor: "#FF8042",
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: "Peak Times" },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  }

  // Inflows/Outflows by Category (bar chart)
  if (chartType === "inflowsByCategory" || chartType === "outflowsByCategory") {
    const labels = chartData.map((d) => d.category || "");
    const amounts = chartData.map((d) => d.amount || 0);

    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: chartType === "inflowsByCategory" ? "Inflows" : "Outflows",
            data: amounts,
            backgroundColor:
              chartType === "inflowsByCategory" ? "#00C49F" : "#FF8042",
          },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { position: "bottom" },
          title: {
            display: true,
            text:
              chartType === "inflowsByCategory"
                ? "Inflows by Category"
                : "Outflows by Category",
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (value: any) {
                return "$" + value.toLocaleString();
              },
            },
          },
        },
      },
    };
  }

  // Default: return null for unsupported chart types
  return null;
}

/**
 * Get color for weekday in heatmap
 */
function getWeekdayColor(weekday: number): string {
  const colors = [
    "", // 0 - unused
    "#3B82F6", // Mon - Blue
    "#10B981", // Tue - Green
    "#F59E0B", // Wed - Orange
    "#EF4444", // Thu - Red
    "#8B5CF6", // Fri - Purple
    "#EC4899", // Sat - Pink
    "#06B6D4", // Sun - Cyan
  ];
  return colors[weekday] || "#6B7280";
}

function formatCurrency(
  num: number | undefined | null,
  config?: ReportConfig
): string {
  if (num === undefined || num === null || isNaN(num)) return "–";
  const currency = config?.currency || "EUR";
  return formatCurrencyUtil(num, currency);
}

/**
 * Format fitness studio KPI values based on their type
 */

function formatFitnessStudioKpiValue(
  cardId: string,
  value: number | string | null,
  config?: ReportConfig
): string {
  if (value === null || value === undefined) return "N/A";

  // Percentage KPIs
  const percentageKpis = [
    "utilizationRate",
    "monthlyChurnRate",
    "churnRate",
    "cancellationRate",
    "noShowRate",
    "capacityUtilization",
    "grossMargin",
    "engagementRate",
    "instructorCancellationRate",
  ];

  if (percentageKpis.includes(cardId)) {
    if (typeof value === "number") {
      return `${value.toFixed(1)}%`;
    }
    return String(value);
  }

  // Count KPIs (no currency formatting)
  const countKpis = [
    "activeMembers",
    "newMembers",
    "totalMembers",
    "totalClassesHeld",
    "avgAttendeesPerClass",
    "activeInstructors",
    "classesTaught",
    "avgMemberTenure",
    "avgClassOccupancy",
    "avgOccupancyPerInstructor",
    "netMemberGrowth",
  ];

  if (countKpis.includes(cardId)) {
    if (typeof value === "number") {
      return formatNumberUtil(value, config?.numberFormat);
    }
    return String(value);
  }

  // Currency KPIs
  const currencyKpis = [
    "monthlyRevenue",
    "totalRevenue",
    "netIncome",
    "revenuePerMember",
    "revenuePerClass",
    "revenuePerInstructor",
    "totalCosts",
    "netCashFlow",
    "burnRate",
  ];

  if (currencyKpis.includes(cardId)) {
    if (typeof value === "number") {
      return formatCurrency(value, config);
    }
    return String(value);
  }

  // Default: format as number or return as string
  if (typeof value === "number") {
    return formatNumberUtil(value, config?.numberFormat);
  }
  return String(value);
}
