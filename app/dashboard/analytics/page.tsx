"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { SalesPipeline } from "@/components/dashboard/sales-pipeline";
import { CashFlowAnalysis } from "@/components/dashboard/cash-flow-analysis";
import { BarChart } from "lucide-react";

// Helper component for locked/missing data placeholders
const LockedPlaceholder = ({ message }: { message: string }) => (
  <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
    💡 {message}
  </div>
);

type DataStatus = {
  ok?: boolean;
  bank?: boolean;
  crm?: boolean;
  budget?: boolean;
} | null;

export default function AnalyticsPage() {
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);

  // Check if user has uploaded data via Supabase/API
  const checkUploadedData = async () => {
    try {
      const res = await fetch("/api/data/status");

      if (!res.ok) {
        setDataStatus(null);
        return;
      }

      const json = await res.json();
      setDataStatus(json);
    } catch (err) {
      setDataStatus(null);
    }
  };

  useEffect(() => {
    checkUploadedData();
  }, []);

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BarChart className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
          </div>
          <p className="text-muted-foreground">
            Deep dive into your financial performance, sales pipeline, and cash
            flow metrics
          </p>
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="financial" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 mb-6 shadow-sm">
            <TabsTrigger
              value="financial"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Financial Analysis
            </TabsTrigger>
            <TabsTrigger
              value="sales"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Sales Pipeline
            </TabsTrigger>
            <TabsTrigger
              value="cashflow"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Cash Flow
            </TabsTrigger>
          </TabsList>

          <TabsContent value="financial" className="space-y-4">
            {dataStatus?.budget ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <FinancialCharts type="income-statement" />
                  <FinancialCharts type="variance-analysis" />
                </div>
                <FinancialCharts type="ytd-performance" />
              </>
            ) : (
              <LockedPlaceholder message="To unlock Financial Analysis, upload your budget data on the Upload page." />
            )}
          </TabsContent>

          <TabsContent value="sales" className="space-y-4">
            {dataStatus?.crm ? (
              <SalesPipeline />
            ) : (
              <LockedPlaceholder message="To unlock your Sales Pipeline, upload your CRM data on the Upload page." />
            )}
          </TabsContent>

          <TabsContent value="cashflow" className="space-y-4">
            {dataStatus?.bank ? (
              <CashFlowAnalysis />
            ) : (
              <LockedPlaceholder message="To unlock Cash Flow Analysis, upload your bank transaction data on the Upload page." />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
