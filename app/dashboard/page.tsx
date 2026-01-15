"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MetricsGrid } from "@/components/dashboard/metrics-grid";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { MetricSelector } from "@/components/dashboard/metric-selector";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { useBusinessContext } from "@/lib/business-context";
import { UploadInvitation } from "@/components/dashboard/upload-invitation";
import { KpiSelector } from "@/components/dashboard/kpi-selector";
import { KpisGrid } from "@/components/dashboard/kpis-grid";
import type { DatabaseKpi } from "@/lib/types/kpi";

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

export default function DashboardPage() {
  const { businessType } = useBusinessContext();
  // Core KPIs that always show
  const coreKpiIds = ["mrr", "arr", "cashBalance", "burnRate"];
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    ...coreKpiIds,
    "contracted",
    "ltmRevenue",
    "netMargin",
    "customers",
  ]);
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);

  // KPI state
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<DatabaseKpi[]>([]);
  const [recommendedKpis, setRecommendedKpis] = useState<DatabaseKpi[]>([]);
  const [additionalKpis, setAdditionalKpis] = useState<DatabaseKpi[]>([]);
  const [companyBusinessType, setCompanyBusinessType] = useState<string | null>(
    null
  );

  // Fetch company business model and data status
  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          // Get company
          const { data: company } = await supabase
            .from("companies")
            .select("id")
            .eq("created_by", user.id)
            .single();

          if (company) {
            // Get business model for company
            const { data: businessModel } = await supabase
              .from("business_models")
              .select("business_type")
              .eq("company_id", company.id)
              .single();

            if (businessModel?.business_type) {
              setCompanyBusinessType(businessModel.business_type);
            }
          }

          // Fetch data status
          const statusRes = await fetch("/api/data/status");
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setDataStatus(statusData);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  // Load selected KPIs and available KPIs
  useEffect(() => {
    const loadKpis = async () => {
      try {
        const res = await fetch("/api/onboarding/kpi-preferences");
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        const kpiIds = (data.selectedKpiIds ?? []) as string[];
        const recommended = (data.recommendedKpis ?? []) as DatabaseKpi[];
        const additional = (data.additionalKpis ?? []) as DatabaseKpi[];

        setSelectedKpiIds(kpiIds);
        setRecommendedKpis(recommended);
        setAdditionalKpis(additional);

        // Filter to get only selected KPI objects
        const allKpis = [...recommended, ...additional];
        const selected = allKpis.filter((kpi) => kpiIds.includes(kpi.id));
        setSelectedKpis(selected);
      } catch (err) {
        console.error("Error loading KPIs:", err);
      }
    };

    loadKpis();
  }, []);

  const handleKpisChange = (newKpiIds: string[]) => {
    setSelectedKpiIds(newKpiIds);
    const allKpis = [...recommendedKpis, ...additionalKpis];
    const selected = allKpis.filter((kpi) => newKpiIds.includes(kpi.id));
    setSelectedKpis(selected);
  };

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        {/* Show business type badge */}
        {companyBusinessType && (
          <div className="mb-6 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Business Type:
            </span>
            <span className="text-sm font-medium text-primary">
              {companyBusinessType}
            </span>
          </div>
        )}

        {/* Upload Invitation Section - Show if user hasn't uploaded data */}
        {dataStatus && !(dataStatus.bank || dataStatus.crm || dataStatus.budget) && (
          <div className="mb-8">
            <UploadInvitation />
          </div>
        )}

        {/* Overview Section - Key Metrics and Performance Charts */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Key Metrics</h2>
            <div className="flex items-center gap-2">
              <MetricSelector
                selectedMetrics={selectedMetrics}
                onMetricsChange={(metrics) => setSelectedMetrics(metrics)}
                businessType={businessType}
              />
            </div>
          </div>

          {dataStatus?.bank || dataStatus?.crm || dataStatus?.budget ? (
            <>
              <MetricsGrid selectedMetrics={selectedMetrics} />
              <div className="mt-8">
                <DashboardInsights />
              </div>
              <div className="space-y-4 mt-8">
                <h2 className="text-lg font-semibold">Performance Charts</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <FinancialCharts type="mrr-vs-plan" />
                  <FinancialCharts type="burn-rate" />
                </div>
              </div>
            </>
          ) : (
            <LockedPlaceholder message="Upload your financial data (bank transactions, CRM, or budget) in the 'Upload Financial Data' section above to see your key metrics and performance charts." />
          )}

          {/* KPIs Section */}
          <div className="mt-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Key Performance Indicators
              </h2>
              <KpiSelector
                selectedKpiIds={selectedKpiIds}
                onKpisChange={handleKpisChange}
                recommendedKpis={recommendedKpis}
                additionalKpis={additionalKpis}
              />
            </div>
            <KpisGrid selectedKpis={selectedKpis} />
          </div>
        </div>
      </div>
    </div>
  );
}
