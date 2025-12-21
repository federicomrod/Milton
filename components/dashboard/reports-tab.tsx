// components/dashboard/reports-tab.tsx
"use client";

import { useState } from "react";
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
import { FileDown, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { generateReportSlides } from "@/lib/pdf-generator-slides";
import { getReportData } from "@/lib/report-data-service";
import { generateInsights } from "@/lib/ai/insights";
import { generateChartImages } from "@/lib/chart-generator";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { useReportData } from "@/lib/hooks/useReportData";
import { DEFAULT_REPORT_CONFIG, type ReportConfig } from "@/lib/types/report";
import {
  parsePeriodLabel,
  generateMonthOptions,
} from "@/lib/utils/report-utils";
import { DataAvailabilityAlert } from "./reports/DataAvailabilityAlert";
import { ReportSectionSelector } from "./reports/ReportSectionSelector";
import { ReportPreview } from "./reports/ReportPreview";

export function ReportsTab() {
  const { prefs } = useUserPreferences();
  const { isClient, dataStatus } = useReportData();
  const [config, setConfig] = useState<ReportConfig>(DEFAULT_REPORT_CONFIG);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "generating" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    overview: true,
    financial: false,
    sales: false,
    cashflow: false,
  });

  const handleConfigChange = (field: keyof ReportConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleCardSelectionChange = (
    section:
      | "overviewCards"
      | "financialCards"
      | "salesCards"
      | "cashFlowCards",
    card: string,
    value: boolean
  ) => {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [card]: value,
      },
    }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
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

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("No authenticated user found. Please log in.");
      }

      const periodRange = parsePeriodLabel(config.reportPeriod);

      // Fetch report data from Supabase with period filter
      const reportData = await getReportData(
        supabase,
        user.id,
        periodRange || undefined
      );

      // Generate AI insights for each section
      let insights: {
        overview?: string[];
        financial?: string[];
        pipeline?: string[];
        cashflow?: string[];
      } = {};
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

      // Generate chart images using QuickChart API
      const chartImages = await generateChartImages(reportData);

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
        },
        insights,
        chartImages
      );

      setGenerationStatus("success");
      setTimeout(() => setGenerationStatus("idle"), 3000);
    } catch (err) {
      console.error("PDF Generation Error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate PDF. Please try again."
      );
      setGenerationStatus("error");
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

          <div className="space-y-2">
            <Label htmlFor="period">Report Period</Label>
            <Select
              value={config.reportPeriod}
              onValueChange={(value) =>
                handleConfigChange("reportPeriod", value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {generateMonthOptions(12).map((monthYear) => (
                  <SelectItem key={monthYear} value={monthYear}>
                    {monthYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Section Selection with Card Details */}
          <ReportSectionSelector
            config={config}
            expandedSections={expandedSections}
            onConfigChange={handleConfigChange}
            onCardSelectionChange={handleCardSelectionChange}
            onToggleSection={toggleSection}
          />

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

          {/* Generate Button */}
          <Button
            onClick={generatePDF}
            disabled={
              isGenerating ||
              !dataStatus.hasAnyData ||
              (!config.includeOverview &&
                !config.includeFinancial &&
                !config.includeSales &&
                !config.includeCashFlow)
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
