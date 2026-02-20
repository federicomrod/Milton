"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import MiltonChat from "@/components/dashboard/miltonchat";
import { createClient } from "@/lib/supabase/client";
import { DataStatusProvider } from "@/lib/context/DataStatusContext";
import { BusinessProvider } from "@/lib/business-context";
import { useUser } from "@/lib/context/UserContext";
import { miltonEventsAPI } from "@/lib/milton-events";

type DataStatus = {
  ok?: boolean;
  bank?: boolean;
  crm?: boolean;
  budget?: boolean;
} | null;

const DashboardContent = ({ children }: { children: React.ReactNode }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);
  const [businessModel, setBusinessModel] = useState<string>("");
  const [selectedKpis, setSelectedKpis] = useState<any[]>([]);
  const supabase = useMemo(() => createClient(), []);
  const [sessionReady, setSessionReady] = useState(false);
  const { user } = useUser();

  const ensureSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) return true;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return !!refreshed?.session?.access_token;
  }, [supabase]);

  // Load selected KPIs for company from database
  useEffect(() => {
    (async () => {
      try {
        if (!user) return;

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
            setBusinessModel(businessModel.business_type);

            // Fetch selected KPIs from API (source of truth: business_models.selected_kpi_ids)
            const selectedRes = await fetch("/api/kpis/selected", {
              credentials: "include",
            });
            const selectedJson = selectedRes.ok
              ? await selectedRes.json()
              : { selectedKpis: [] };
            const selectedKpis = Array.isArray(selectedJson?.selectedKpis)
              ? selectedJson.selectedKpis
              : [];
            setSelectedKpis(selectedKpis);

            // Calculate KPI values - use a wider date range to include older data
            const fromDate = new Date(
              Date.now() - 2 * 365 * 24 * 60 * 60 * 1000
            )
              .toISOString()
              .split("T")[0]; // 2 years ago
            const toDate = new Date().toISOString().split("T")[0]; // today

            const calculateRes = await fetch("/api/kpis/calculate", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from_date: fromDate,
                to_date: toDate,
              }),
            });
            const calculateJson = calculateRes.ok
              ? await calculateRes.json()
              : { calculatedKpis: [] };
            const calculatedKpis = Array.isArray(calculateJson?.calculatedKpis)
              ? calculateJson.calculatedKpis
              : [];

            miltonEventsAPI.publish("business.context", {
              businessModel: businessModel.business_type,
              selectedKpis: selectedKpis,
            });
            miltonEventsAPI.publish("dashboard.data.ready", {
              kpis: calculatedKpis,
              selectedKpis: selectedKpis,
              businessModel: businessModel.business_type,
            });
          }
        }
      } catch (error) {
        console.error(
          "[DashboardLayout] Error fetching business model:",
          error
        );
      }
    })();
  }, [user, supabase]);

  // Hydrate session and set sessionReady
  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await ensureSession();
      if (mounted) setSessionReady(ok);
    })();
    return () => {
      mounted = false;
    };
  }, [ensureSession]);

  // Listen to dashboard generation events, but only when sessionReady
  useEffect(() => {
    if (!sessionReady) return;
    const unsubscribe = miltonEventsAPI.subscribe(
      "dashboard.generate",
      async (payload) => {
        try {
          if (!user) {
            console.warn("[DashboardLayout] No user authenticated");
            return;
          }
          // Get company for selected KPIs
          const { data: company } = await supabase
            .from("companies")
            .select("id")
            .eq("created_by", user.id)
            .single();

          if (company) {
            // Get selected KPIs
            const selectedRes = await fetch("/api/kpis/selected", {
              credentials: "include",
            });
            const selectedJson = selectedRes.ok
              ? await selectedRes.json()
              : { selectedKpis: [] };
            const selectedKpis = Array.isArray(selectedJson?.selectedKpis)
              ? selectedJson.selectedKpis
              : [];
            setSelectedKpis(selectedKpis);

            // Calculate KPI values - use a wider date range to include older data
            const fromDate = new Date(
              Date.now() - 2 * 365 * 24 * 60 * 60 * 1000
            )
              .toISOString()
              .split("T")[0]; // 2 years ago
            const toDate = new Date().toISOString().split("T")[0]; // today

            const calculateRes = await fetch("/api/kpis/calculate", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from_date: fromDate,
                to_date: toDate,
              }),
            });
            const calculateJson = calculateRes.ok
              ? await calculateRes.json()
              : { calculatedKpis: [] };
            const calculatedKpis = Array.isArray(calculateJson?.calculatedKpis)
              ? calculateJson.calculatedKpis
              : [];

            miltonEventsAPI.publish("dashboard.data.ready", {
              kpis: calculatedKpis,
              selectedKpis: selectedKpis,
              businessModel: payload.businessModel,
            });
          }
          console.log("[DashboardLayout] Dashboard data ready event published");
        } catch (err) {
          console.error("[DashboardLayout] Error generating dashboard:", err);
        }
      }
    );
    return () => unsubscribe();
  }, [sessionReady, supabase, user]);

  const refreshDataStatus = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/data/status", {
        credentials: "include",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      try {
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        setDataStatus(json);
      } catch (parseError) {
        console.error("Invalid JSON from /api/data/status:", parseError);
        setDataStatus(null);
      }
    } catch (error) {
      console.error("Failed to refresh data status:", error);
      setDataStatus(null);
    }
  }, []);

  useEffect(() => {
    // Use setTimeout to avoid synchronous setState in effect
    const timer = setTimeout(() => {
      refreshDataStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshDataStatus]);

  // Listen for custom event to force-refresh data status when uploads complete
  useEffect(() => {
    const handler = () => refreshDataStatus();
    window.addEventListener("data-status:refresh", handler);
    return () => window.removeEventListener("data-status:refresh", handler);
  }, [refreshDataStatus]);

  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname?.startsWith("/dashboard")) return; // ignore non-dashboard routes

    // Skip redirect for pages that don't require data
    if (pathname.startsWith("/dashboard/model")) return; // Data Model Builder
    if (pathname.startsWith("/dashboard/analytics")) return; // Analytics page
    if (pathname.startsWith("/dashboard/reporting")) return; // Reporting page
    if (pathname.startsWith("/dashboard/account")) return; // Account page
    if (pathname.startsWith("/dashboard/settings")) return; // Settings page
    if (pathname.startsWith("/dashboard/upload")) return; // Upload page
    if (pathname.startsWith("/dashboard/data")) return; // Data Management page

    // Only redirect if user is NOT already on dashboard
    if (pathname === "/dashboard") return;

    if (
      dataStatus?.ok &&
      !dataStatus.bank &&
      !dataStatus.crm &&
      !dataStatus.budget
    ) {
      console.log("Redirecting user to /dashboard due to missing data...");
      router.replace("/dashboard");
    }
  }, [
    pathname,
    dataStatus?.ok,
    dataStatus?.bank,
    dataStatus?.crm,
    dataStatus?.budget,
    router,
  ]);

  return (
    <BusinessProvider>
      <DataStatusProvider value={{ refreshDataStatus }}>
        <div style={{ position: "relative", minHeight: "100vh" }}>
          {children}
          {/* Chat Toggle Button - Hide when chat is open */}
          {!isChatOpen && (
            <button
              aria-label="Open Milton Chat"
              onClick={() => setIsChatOpen(true)}
              style={{
                position: "fixed",
                right: 32,
                bottom: 32,
                zIndex: 10050,
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                border: "none",
                fontSize: 28,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              💬
            </button>
          )}
          {/* Sliding Chat Panel */}
          <div
            className="fixed top-0 right-0 h-screen w-[33.333vw] max-w-[420px] min-w-[320px] bg-background shadow-[0_0_24px_rgba(0,0,0,0.2)] z-[10000] flex flex-col transition-transform duration-300 ease-out"
            style={{
              transform: isChatOpen ? "translateX(0)" : "translateX(100%)",
            }}
          >
            <div className="chat-panel p-4 h-full flex flex-col overflow-hidden">
              <MiltonChat onClose={() => setIsChatOpen(false)} />
            </div>
          </div>
        </div>
      </DataStatusProvider>
    </BusinessProvider>
  );
};

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  return <DashboardContent>{children}</DashboardContent>;
};

export default DashboardLayout;
