'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinancialCharts } from '@/components/dashboard/financial-charts'
import { SalesPipeline } from '@/components/dashboard/sales-pipeline'
import { CashFlowAnalysis } from '@/components/dashboard/cash-flow-analysis'
import { BarChart } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BarChart className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          </div>
          <p className="text-gray-600">
            Deep dive into your financial performance, sales pipeline, and cash flow metrics
          </p>
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="financial" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="financial">Financial Analysis</TabsTrigger>
            <TabsTrigger value="sales">Sales Pipeline</TabsTrigger>
            <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="financial" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FinancialCharts type="income-statement" />
              <FinancialCharts type="variance-analysis" />
            </div>
            <FinancialCharts type="ytd-performance" />
          </TabsContent>

          <TabsContent value="sales" className="space-y-4">
            <SalesPipeline />
          </TabsContent>

          <TabsContent value="cashflow" className="space-y-4">
            <CashFlowAnalysis />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

