"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { miltonEventsAPI } from "@/lib/milton-events";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricsGrid } from "@/components/dashboard/metrics-grid";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { MetricSelector } from "@/components/dashboard/metric-selector";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { useBusinessContext } from "@/lib/business-context";
import { UploadInvitation } from "@/components/dashboard/upload-invitation";
import { KpiSelector } from "@/components/dashboard/kpi-selector";
import { KpisGrid } from "@/components/dashboard/kpis-grid";
import type { DatabaseKpi } from "@/lib/types/kpi";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const router = useRouter();
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
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(true);
  const [hasUploadedData, setHasUploadedData] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);
  const [dataStatusLoading, setDataStatusLoading] = useState(true);
  const [pendingUpload, setPendingUpload] = useState<{
    file: File | null;
    datasetType: "bank" | "crm" | "budget" | null;
  } | null>(null);
  const [showUploadModeDialog, setShowUploadModeDialog] = useState(false);

  // KPI state
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<DatabaseKpi[]>([]);
  const [recommendedKpis, setRecommendedKpis] = useState<DatabaseKpi[]>([]);
  const [additionalKpis, setAdditionalKpis] = useState<DatabaseKpi[]>([]);
  const [companyBusinessType, setCompanyBusinessType] = useState<string | null>(
    null
  );

  // Check if user has uploaded data via Supabase/API
  const checkUploadedData = async () => {
    setDataStatusLoading(true);
    try {
      const res = await fetch("/api/data/status");

      if (!res.ok) {
        setIsUploadOpen(true);
        setDataStatus(null);
        setHasUploadedData(false);
        setDataStatusLoading(false);
        return;
      }

      const json = await res.json();

      // Update dataStatus state for conditional rendering
      setDataStatus(json);

      const hasData = !!(json?.bank || json?.crm || json?.budget);
      setHasUploadedData(hasData);

      // If no data, keep upload section open by default
      if (!hasData) {
        setIsUploadOpen(true);
      }
    } catch (err) {
      setIsUploadOpen(true);
      setDataStatus(null);
      setHasUploadedData(false);
    } finally {
      setDataStatusLoading(false);
    }
  };

  // Upload file with specified mode
  const uploadFileWithMode = async (
    file: File,
    datasetType: "bank" | "crm" | "budget",
    mode: "overwrite" | "append"
  ) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("datasetType", datasetType);
      formData.append("mode", mode);

      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        alert("Upload failed: " + errorText);
        return;
      }

      await res.json();

      // Refresh data status and trigger dashboard generation
      await checkUploadedData();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
      miltonEventsAPI.publish("dashboard.generate", {
        businessModel: companyBusinessType || selectedUseCase || "",
      });
    } catch (err) {
      alert("Upload error: " + (err as Error).message);
    }
  };

  // Handle file selected from dashboard uploader
  const handleDashboardFileSelected = async (
    file: File,
    datasetType: "bank" | "crm" | "budget"
  ) => {
    const alreadyHasData =
      (datasetType === "bank" && dataStatus?.bank) ||
      (datasetType === "crm" && dataStatus?.crm) ||
      (datasetType === "budget" && dataStatus?.budget);

    if (alreadyHasData) {
      setPendingUpload({ file, datasetType });
      setShowUploadModeDialog(true);
    } else {
      await uploadFileWithMode(file, datasetType, "append");
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(false);
    };

    // Fetch company business model
    const fetchCompanyBusinessModel = async () => {
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
        }
      } catch (error) {
        console.error("Error fetching company business model:", error);
      }
    };

    checkAuth();
    checkUploadedData();
    fetchCompanyBusinessModel();
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

  const updateBusinessModel = async (newBusinessType: string) => {
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
          // Update business model in database
          const { error } = await supabase.from("business_models").upsert(
            {
              company_id: company.id,
              business_type: newBusinessType,
            },
            { onConflict: "company_id" }
          );

          if (error) {
            console.error("Failed to update business model:", error);
            alert("Failed to update business type. Please try again.");
          } else {
            // Update local state
            setCompanyBusinessType(newBusinessType);
          }
        }
      }
    } catch (error) {
      console.error("Error updating business model:", error);
      alert("Failed to update business type. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

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

        {/* Upload Invitation Section - Only show if user hasn't uploaded data, and only after we've checked */}
        {!dataStatusLoading && !hasUploadedData && (
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

      {/* Upload Mode Dialog */}
      {showUploadModeDialog && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-md bg-card border border-border p-6 shadow-lg max-w-md w-full space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              How should I use this file?
            </h2>
            <p className="text-sm text-muted-foreground">
              We detected existing data for this dataset type. Do you want to{" "}
              <strong>overwrite the existing data</strong> or treat this as a{" "}
              <strong>new dataset</strong> and review it in the Data Model
              Builder?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                }}
                className="rounded bg-muted px-3 py-1.5 text-sm hover:bg-muted/80 text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return;
                  await uploadFileWithMode(
                    pendingUpload.file!,
                    pendingUpload.datasetType!,
                    "overwrite"
                  );
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Overwrite existing data
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return;
                  await uploadFileWithMode(
                    pendingUpload.file!,
                    pendingUpload.datasetType!,
                    "append"
                  );
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                  // redirect to Model Builder so user can inspect the new data
                  router.push("/dashboard/model");
                }}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Treat as new dataset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
