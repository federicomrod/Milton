// components/dashboard/reports/ReportSectionSelector.tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReportConfig } from "@/lib/types/report";

interface ReportSectionSelectorProps {
  config: ReportConfig;
  expandedSections: Record<string, boolean>;
  onConfigChange: (field: keyof ReportConfig, value: unknown) => void;
  onCardSelectionChange: (
    section:
      | "overviewCards"
      | "financialCards"
      | "salesCards"
      | "cashFlowCards",
    card: string,
    value: boolean
  ) => void;
  onToggleSection: (section: string) => void;
}

export function ReportSectionSelector({
  config,
  expandedSections,
  onConfigChange,
  onCardSelectionChange,
  onToggleSection,
}: ReportSectionSelectorProps) {
  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        Include Sections & Select Cards
      </Label>

      {/* Overview Section */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Checkbox
            id="overview"
            checked={config.includeOverview}
            onCheckedChange={(checked) =>
              onConfigChange("includeOverview", checked)
            }
          />
          <div className="flex-1">
            <Label
              htmlFor="overview"
              className="text-sm font-medium cursor-pointer"
            >
              Overview & Performance
            </Label>
            <p className="text-xs text-gray-600">
              Key metrics and performance summary
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSection("overview")}
            disabled={!config.includeOverview}
          >
            {expandedSections.overview ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {config.includeOverview && expandedSections.overview && (
          <div className="ml-6 space-y-2 border-l-2 border-green-200 pl-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="metricsGrid"
                checked={config.overviewCards.metricsGrid}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "overviewCards",
                    "metricsGrid",
                    checked as boolean
                  )
                }
              />
              <Label htmlFor="metricsGrid" className="text-xs cursor-pointer">
                Key Metrics Grid (MRR, ARR, Cash Balance, etc.)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="performanceCharts"
                checked={config.overviewCards.performanceCharts}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "overviewCards",
                    "performanceCharts",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="performanceCharts"
                className="text-xs cursor-pointer"
              >
                Performance Charts & Trends
              </Label>
            </div>
          </div>
        )}
      </div>

      {/* Financial Section */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Checkbox
            id="financial"
            checked={config.includeFinancial}
            onCheckedChange={(checked) =>
              onConfigChange("includeFinancial", checked)
            }
          />
          <div className="flex-1">
            <Label
              htmlFor="financial"
              className="text-sm font-medium cursor-pointer"
            >
              Financial Analysis
            </Label>
            <p className="text-xs text-gray-600">
              Revenue, expenses, and margins
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSection("financial")}
            disabled={!config.includeFinancial}
          >
            {expandedSections.financial ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {config.includeFinancial && expandedSections.financial && (
          <div className="ml-6 space-y-2 border-l-2 border-purple-200 pl-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="revenueBreakdown"
                checked={config.financialCards.revenueBreakdown}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "financialCards",
                    "revenueBreakdown",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="revenueBreakdown"
                className="text-xs cursor-pointer"
              >
                Revenue Breakdown by Source
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="expenseAnalysis"
                checked={config.financialCards.expenseAnalysis}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "financialCards",
                    "expenseAnalysis",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="expenseAnalysis"
                className="text-xs cursor-pointer"
              >
                Expense Analysis vs Budget
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="varianceReport"
                checked={config.financialCards.varianceReport}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "financialCards",
                    "varianceReport",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="varianceReport"
                className="text-xs cursor-pointer"
              >
                Budget Variance Report
              </Label>
            </div>
          </div>
        )}
      </div>

      {/* Sales Section */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Checkbox
            id="sales"
            checked={config.includeSales}
            onCheckedChange={(checked) =>
              onConfigChange("includeSales", checked)
            }
          />
          <div className="flex-1">
            <Label
              htmlFor="sales"
              className="text-sm font-medium cursor-pointer"
            >
              Sales Pipeline
            </Label>
            <p className="text-xs text-gray-600">Deals and pipeline analysis</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSection("sales")}
            disabled={!config.includeSales}
          >
            {expandedSections.sales ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {config.includeSales && expandedSections.sales && (
          <div className="ml-6 space-y-2 border-l-2 border-orange-200 pl-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="pipelineMetrics"
                checked={config.salesCards.pipelineMetrics}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "salesCards",
                    "pipelineMetrics",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="pipelineMetrics"
                className="text-xs cursor-pointer"
              >
                Pipeline Summary Metrics
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="pipelineByStage"
                checked={config.salesCards.pipelineByStage}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "salesCards",
                    "pipelineByStage",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="pipelineByStage"
                className="text-xs cursor-pointer"
              >
                Pipeline by Stage Table
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="pipelineByClosingDate"
                checked={config.salesCards.pipelineByClosingDate}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "salesCards",
                    "pipelineByClosingDate",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="pipelineByClosingDate"
                className="text-xs cursor-pointer"
              >
                Pipeline by Closing Date
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="dealSources"
                checked={config.salesCards.dealSources}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "salesCards",
                    "dealSources",
                    checked as boolean
                  )
                }
              />
              <Label htmlFor="dealSources" className="text-xs cursor-pointer">
                Deal Sources & Channels
              </Label>
            </div>
          </div>
        )}
      </div>

      {/* Cash Flow Section */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Checkbox
            id="cashflow"
            checked={config.includeCashFlow}
            onCheckedChange={(checked) =>
              onConfigChange("includeCashFlow", checked)
            }
          />
          <div className="flex-1">
            <Label
              htmlFor="cashflow"
              className="text-sm font-medium cursor-pointer"
            >
              Cash Flow Analysis
            </Label>
            <p className="text-xs text-gray-600">Cash trends and runway</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSection("cashflow")}
            disabled={!config.includeCashFlow}
          >
            {expandedSections.cashflow ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {config.includeCashFlow && expandedSections.cashflow && (
          <div className="ml-6 space-y-2 border-l-2 border-cyan-200 pl-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="currentBalance"
                checked={config.cashFlowCards.currentBalance}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "cashFlowCards",
                    "currentBalance",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="currentBalance"
                className="text-xs cursor-pointer"
              >
                Current Balance Card
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="monthlyBurnRate"
                checked={config.cashFlowCards.monthlyBurnRate}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "cashFlowCards",
                    "monthlyBurnRate",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="monthlyBurnRate"
                className="text-xs cursor-pointer"
              >
                Monthly Burn Rate Card
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="cashRunway"
                checked={config.cashFlowCards.cashRunway}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "cashFlowCards",
                    "cashRunway",
                    checked as boolean
                  )
                }
              />
              <Label htmlFor="cashRunway" className="text-xs cursor-pointer">
                Cash Runway Analysis
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="monthlyTrend"
                checked={config.cashFlowCards.monthlyTrend}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "cashFlowCards",
                    "monthlyTrend",
                    checked as boolean
                  )
                }
              />
              <Label htmlFor="monthlyTrend" className="text-xs cursor-pointer">
                Monthly Trend Table
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="inflowOutflowBreakdown"
                checked={config.cashFlowCards.inflowOutflowBreakdown}
                onCheckedChange={(checked) =>
                  onCardSelectionChange(
                    "cashFlowCards",
                    "inflowOutflowBreakdown",
                    checked as boolean
                  )
                }
              />
              <Label
                htmlFor="inflowOutflowBreakdown"
                className="text-xs cursor-pointer"
              >
                Inflow/Outflow Breakdown
              </Label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
