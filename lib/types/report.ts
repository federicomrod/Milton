// lib/types/report.ts

export interface ReportConfig {
  title: string;
  companyName: string;
  reportPeriod: string;
  includeOverview: boolean;
  includeFinancial: boolean;
  includeSales: boolean;
  includeCashFlow: boolean;
  // Enhanced card selections
  overviewCards: {
    metricsGrid: boolean;
    performanceCharts: boolean;
  };
  financialCards: {
    revenueBreakdown: boolean;
    expenseAnalysis: boolean;
    varianceReport: boolean;
  };
  salesCards: {
    pipelineMetrics: boolean;
    pipelineByStage: boolean;
    pipelineByClosingDate: boolean;
    dealSources: boolean;
  };
  cashFlowCards: {
    currentBalance: boolean;
    monthlyBurnRate: boolean;
    cashRunway: boolean;
    monthlyTrend: boolean;
    inflowOutflowBreakdown: boolean;
  };
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  title: "Monthly Business Report",
  companyName: "Your Company",
  reportPeriod: new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  }),
  includeOverview: true,
  includeFinancial: true,
  includeSales: true,
  includeCashFlow: true,
  overviewCards: {
    metricsGrid: true,
    performanceCharts: true,
  },
  financialCards: {
    revenueBreakdown: true,
    expenseAnalysis: true,
    varianceReport: false,
  },
  salesCards: {
    pipelineMetrics: true,
    pipelineByStage: true,
    pipelineByClosingDate: false,
    dealSources: false,
  },
  cashFlowCards: {
    currentBalance: true,
    monthlyBurnRate: true,
    cashRunway: true,
    monthlyTrend: true,
    inflowOutflowBreakdown: false,
  },
};
