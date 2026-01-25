// lib/types/report.ts

export interface ReportConfig {
  title: string;
  companyName: string;
  reportPeriod: string;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  title: "Monthly Business Report",
  companyName: "Your Company",
  reportPeriod: new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  }),
};
