// components/dashboard/reports/ReportPreview.tsx
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

export function ReportPreview({ config }: ReportPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Preview</CardTitle>
        <CardDescription>
          Preview of your report structure and selected content
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Cover Slide */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border-l-4 border-blue-500">
            <div>
              <h3 className="font-semibold">Cover Slide</h3>
              <p className="text-sm text-gray-600">
                {config.title} • {config.companyName}
              </p>
            </div>
            <Badge variant="secondary">Always Included</Badge>
          </div>

          {/* Dynamic Section Previews */}
          {config.includeOverview && (
            <div className="p-4 bg-green-50 rounded-lg border-l-4 border-green-500">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Overview & Performance</h3>
                <Badge className="bg-green-100 text-green-800">Slide 2</Badge>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                {config.overviewCards.metricsGrid && (
                  <div>• Key Metrics Grid (6 cards)</div>
                )}
                {config.overviewCards.performanceCharts && (
                  <div>• Performance Charts</div>
                )}
              </div>
            </div>
          )}

          {config.includeFinancial && (
            <div className="p-4 bg-purple-50 rounded-lg border-l-4 border-purple-500">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Financial Analysis</h3>
                <Badge className="bg-purple-100 text-purple-800">
                  Financial
                </Badge>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                {config.financialCards.revenueBreakdown && (
                  <div>• Revenue Breakdown Table</div>
                )}
                {config.financialCards.expenseAnalysis && (
                  <div>• Expense Analysis Table</div>
                )}
                {config.financialCards.varianceReport && (
                  <div>• Budget Variance Report</div>
                )}
              </div>
            </div>
          )}

          {config.includeSales && (
            <div className="p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Sales Pipeline</h3>
                <Badge className="bg-orange-100 text-orange-800">Sales</Badge>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                {config.salesCards.pipelineMetrics && (
                  <div>• Pipeline Summary (4 cards)</div>
                )}
                {config.salesCards.pipelineByStage && (
                  <div>• Pipeline by Stage Table</div>
                )}
                {config.salesCards.pipelineByClosingDate && (
                  <div>• Pipeline by Closing Date</div>
                )}
                {config.salesCards.dealSources && (
                  <div>• Deal Sources Analysis</div>
                )}
              </div>
            </div>
          )}

          {config.includeCashFlow && (
            <div className="p-4 bg-cyan-50 rounded-lg border-l-4 border-cyan-500">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Cash Flow Analysis</h3>
                <Badge className="bg-cyan-100 text-cyan-800">Cash Flow</Badge>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                {config.cashFlowCards.currentBalance && (
                  <div>• Current Balance Card</div>
                )}
                {config.cashFlowCards.monthlyBurnRate && (
                  <div>• Monthly Burn Rate Card</div>
                )}
                {config.cashFlowCards.cashRunway && (
                  <div>• Cash Runway Analysis</div>
                )}
                {config.cashFlowCards.monthlyTrend && (
                  <div>• Monthly Trend Table</div>
                )}
                {config.cashFlowCards.inflowOutflowBreakdown && (
                  <div>• Inflow/Outflow Breakdown</div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
