"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import MiltonChat from "@/components/dashboard/miltonchat";
import { createClient } from "@/lib/supabase/client";
import { DataStatusProvider } from "@/lib/context/DataStatusContext";
import { BusinessProvider } from "@/lib/business-context";
import { miltonEventsAPI } from "@/lib/milton-events";

type DataStatus = {
  ok?: boolean;
  bank?: boolean;
  crm?: boolean;
  budget?: boolean;
} | null;

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);
  const [insight, setInsight] = useState<string>("");
  const [businessModel, setBusinessModel] = useState<string>("");
  const [recipes, setRecipes] = useState<any[]>([]);
  const [kpiData, setKpiData] = useState<any[]>([]);
  const supabase = useMemo(() => createClient(), []);
  const [sessionReady, setSessionReady] = useState(false);

  const ensureSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) return true;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return !!refreshed?.session?.access_token;
  }, [supabase]);

  // Load KPI recipes for selected business model from database
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
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

            // Fetch selected KPIs instead of template KPIs
            const { getSelectedKpis } =
              await import("@/lib/kpi-recipe-service");
            const r = await getSelectedKpis(company.id);
            setRecipes(r);
            miltonEventsAPI.publish("business.context", {
              businessModel: businessModel.business_type,
              recipes: r,
            });
            console.log(
              "[DashboardLayout] Loaded selected KPIs for company",
              company.id,
              r.length,
              "KPIs"
            );
          }
        }
      } catch (error) {
        console.error(
          "[DashboardLayout] Error fetching business model:",
          error
        );
      }
    })();
  }, [supabase]);

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
        console.log(
          "[DashboardLayout] Dashboard generation triggered for:",
          payload.businessModel
        );
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            console.warn("[DashboardLayout] No user authenticated");
            return;
          }
          const modelRecipes = await getKpiRecipes(payload.businessModel);
          setKpiData([]);
          setRecipes(modelRecipes);
          miltonEventsAPI.publish("dashboard.data.ready", {
            kpis: [],
            recipes: modelRecipes,
            businessModel: payload.businessModel,
          });
          console.log("[DashboardLayout] Dashboard data ready event published");
        } catch (err) {
          console.error("[DashboardLayout] Error generating dashboard:", err);
        }
      }
    );
    return () => unsubscribe();
  }, [sessionReady, supabase]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshDataStatus();
  }, [refreshDataStatus]);

  // Listen for custom event to force-refresh data status when uploads complete
  useEffect(() => {
    const handler = () => refreshDataStatus();
    window.addEventListener("data-status:refresh", handler);
    return () => window.removeEventListener("data-status:refresh", handler);
  }, [refreshDataStatus]);

  useEffect(() => {
    console.log("Data readiness from API:", dataStatus);
  }, [dataStatus]);

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
    if (pathname === "/dashboard") return; // Already on dashboard, no redirect needed

    if (
      dataStatus?.ok &&
      !dataStatus.bank &&
      !dataStatus.crm &&
      !dataStatus.budget
    ) {
      console.log("Redirecting user to /dashboard due to missing data...");
      router.replace("/dashboard");
    }
  }, [pathname, dataStatus, router]);

  return (
    <BusinessProvider>
      <DataStatusProvider value={{ refreshDataStatus }}>
        <div style={{ position: "relative", minHeight: "100vh" }}>
          {children}
          {/* Optional insight preview - removed to prevent duplication */}
          {/* Chat Toggle Button */}
          <button
            aria-label="Open Milton Chat"
            onClick={() => setIsChatOpen((open) => !open)}
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
          {/* Sliding Chat Panel */}
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: "33.333vw",
              maxWidth: 420,
              minWidth: 320,
              background: "#fff",
              boxShadow: "0 0 24px rgba(0,0,0,0.2)",
              zIndex: 10000,
              transform: isChatOpen ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.3s cubic-bezier(.4,0,.2,1)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="chat-panel p-4 h-full">
              <MiltonChat />
            </div>
          </div>
        </div>
      </DataStatusProvider>
    </BusinessProvider>
  );
};

export default DashboardLayout;
