"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancialsAnalytics } from "@/components/dashboard/financials-analytics";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { SalesPipeline } from "@/components/dashboard/sales-pipeline";
import { CashFlowAnalysis } from "@/components/dashboard/cash-flow-analysis";
import { StudioPerformance } from "@/components/dashboard/studio-performance";
import { ClassesUtilization } from "@/components/dashboard/classes-utilization";
import { MembersAnalytics } from "@/components/dashboard/members-analytics";
import { InstructorsAnalytics } from "@/components/dashboard/instructors-analytics";
import { RestaurantRevenueMenu } from "@/components/dashboard/restaurant-revenue-menu";
import { RestaurantOperations } from "@/components/dashboard/restaurant-operations";
import { RestaurantCashFlow } from "@/components/dashboard/restaurant-cash-flow";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { BarChart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
  const [businessModel, setBusinessModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Shared date state for restaurant analytics tabs
  const [restaurantPeriod, setRestaurantPeriod] = useState<
    "month" | "year" | "ytd" | "custom"
  >("month");
  const [restaurantCustomDateRange, setRestaurantCustomDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Shared date state for fitness studio analytics tabs
  const [fitnessPeriod, setFitnessPeriod] = useState<
    "month" | "year" | "ytd" | "custom"
  >("month");
  const [fitnessCustomDateRange, setFitnessCustomDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: new Date(new Date().setMonth(new Date().getMonth() - 6))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

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

  // Fetch business model
  const fetchBusinessModel = async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .single();

      if (company) {
        const { data: businessModelData } = await supabase
          .from("business_models")
          .select("business_type")
          .eq("company_id", company.id)
          .single();

        if (businessModelData?.business_type) {
          setBusinessModel(businessModelData.business_type);
        }
      }
    } catch (err) {
      console.error("Error fetching business model:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkUploadedData();
    fetchBusinessModel();
  }, []);

  const isFitnessStudio = businessModel === "fitness_studio";
  const isRestaurant = businessModel === "restaurant";

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-sm text-muted-foreground">
                Loading analytics...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
            {isFitnessStudio
              ? "Deep dive into your studio performance, members, classes, and financial metrics"
              : isRestaurant
                ? "Deep dive into your restaurant performance, revenue, operations, and cash flow metrics"
                : "Deep dive into your financial performance, sales pipeline, and cash flow metrics"}
          </p>
        </div>

        {/* Analytics Tabs */}
        {isRestaurant ? (
          <Tabs defaultValue="revenue-menu" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 mb-6 shadow-sm">
              <TabsTrigger
                value="revenue-menu"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Revenue & Menu
              </TabsTrigger>
              <TabsTrigger
                value="operations"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Operations
              </TabsTrigger>
              <TabsTrigger
                value="cash-flow"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Cash Flow
              </TabsTrigger>
            </TabsList>

            <TabsContent value="revenue-menu" className="space-y-4">
              <RestaurantRevenueMenu
                period={restaurantPeriod}
                customDateRange={restaurantCustomDateRange}
                onPeriodChange={setRestaurantPeriod}
                onCustomDateRangeChange={setRestaurantCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="operations" className="space-y-4">
              <RestaurantOperations
                period={restaurantPeriod}
                customDateRange={restaurantCustomDateRange}
                onPeriodChange={setRestaurantPeriod}
                onCustomDateRangeChange={setRestaurantCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="cash-flow" className="space-y-4">
              <RestaurantCashFlow
                period={restaurantPeriod}
                customDateRange={restaurantCustomDateRange}
                onPeriodChange={setRestaurantPeriod}
                onCustomDateRangeChange={setRestaurantCustomDateRange}
              />
            </TabsContent>
          </Tabs>
        ) : isFitnessStudio ? (
          <Tabs defaultValue="studio-performance" className="space-y-4">
            <TabsList className="grid w-full grid-cols-6 mb-6 shadow-sm">
              <TabsTrigger
                value="financial"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Financials
              </TabsTrigger>
              <TabsTrigger
                value="studio-performance"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Studio Performance
              </TabsTrigger>
              <TabsTrigger
                value="classes"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Classes & Utilization
              </TabsTrigger>
              <TabsTrigger
                value="members"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Members
              </TabsTrigger>
              <TabsTrigger
                value="instructors"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Instructors
              </TabsTrigger>
              <TabsTrigger
                value="cashflow"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Cash Flow
              </TabsTrigger>
            </TabsList>

            <TabsContent value="financial" className="space-y-4">
              <FinancialsAnalytics
                period={fitnessPeriod}
                customDateRange={fitnessCustomDateRange}
                onPeriodChange={setFitnessPeriod}
                onCustomDateRangeChange={setFitnessCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="studio-performance" className="space-y-4">
              <StudioPerformance
                period={fitnessPeriod}
                customDateRange={fitnessCustomDateRange}
                onPeriodChange={setFitnessPeriod}
                onCustomDateRangeChange={setFitnessCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="classes" className="space-y-4">
              <ClassesUtilization
                period={fitnessPeriod}
                customDateRange={fitnessCustomDateRange}
                onPeriodChange={setFitnessPeriod}
                onCustomDateRangeChange={setFitnessCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="members" className="space-y-4">
              <MembersAnalytics
                period={fitnessPeriod}
                customDateRange={fitnessCustomDateRange}
                onPeriodChange={setFitnessPeriod}
                onCustomDateRangeChange={setFitnessCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="instructors" className="space-y-4">
              <InstructorsAnalytics
                period={fitnessPeriod}
                customDateRange={fitnessCustomDateRange}
                onPeriodChange={setFitnessPeriod}
                onCustomDateRangeChange={setFitnessCustomDateRange}
              />
            </TabsContent>

            <TabsContent value="cashflow" className="space-y-4">
              {dataStatus?.bank ? (
                <CashFlowAnalysis
                  period={fitnessPeriod}
                  customDateRange={fitnessCustomDateRange}
                  onPeriodChange={setFitnessPeriod}
                  onCustomDateRangeChange={setFitnessCustomDateRange}
                />
              ) : (
                <LockedPlaceholder message="To unlock Cash Flow Analysis, upload your bank transaction data on the Upload page." />
              )}
            </TabsContent>
          </Tabs>
        ) : (
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
        )}
      </div>
    </div>
  );
}
