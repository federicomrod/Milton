'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MiltonChat from '@/components/dashboard/miltonchat';
import { createClient } from '@/lib/supabase/client';
import { DataStatusProvider } from '@/lib/context/DataStatusContext';
import { miltonEventsAPI } from '@/lib/milton-events';
import { getKpiSnapshots, getUserKpiSnapshots } from '@/lib/report-data-service';
import { generateIncomeStatementChart } from '@/lib/chart-generator';
import { getKpiRecipes } from '@/lib/kpi-recipe-service';

type DataStatus = {
  ok?: boolean
  bank?: boolean
  crm?: boolean
  budget?: boolean
} | null

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [insight, setInsight] = useState<string>('');
  const [businessModel, setBusinessModel] = useState<string>('');
  const [recipes, setRecipes] = useState<any[]>([]);
  const [kpiData, setKpiData] = useState<any[]>([]);
  const supabase = useMemo(() => createClient(), []);
  const [sessionReady, setSessionReady] = useState(false);
  
  const kpiGenRanRef = useRef(false);
  
  async function runKpiGeneration() {
    if (kpiGenRanRef.current) return;
    kpiGenRanRef.current = true;
    try {
      const res = await fetch('/api/kpi/generate', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      
      // ✅ redirect to dashboard after KPI generation
      router.push('/dashboard');
    } catch (e) {
      console.error('[Dashboard] KPI generation failed', e);
      kpiGenRanRef.current = false;
    }
  }
  
  const ensureSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return true;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return !!refreshed?.session?.access_token;
  }, [supabase]);

  // KPI refresh on dataset events
  useEffect(() => {
    const fetchAndBuildCharts = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const kpis = await getKpiSnapshots(user.id)
        const chart = generateIncomeStatementChart(kpis)
        setChartData(chart)
        console.log('[DashboardLayout] KPI chart data updated', chart)

        // Request insight confirmation from Milton
        miltonEventsAPI.publish('insight.requested', {
          message: '✅ All data sources are linked. Would you like me to generate insights?',
          kpis
        });
      } catch (err) {
        console.error('[DashboardLayout] Error fetching KPIs or insights:', err)
      }
    }

    // Subscribe to dataset events
    const offLinked = miltonEventsAPI.subscribe('datasets.linked', fetchAndBuildCharts)
    const offReady = miltonEventsAPI.subscribe('dataset.ready', fetchAndBuildCharts)
    
    // Subscribe to KPI generation triggers
    const offKpiReady = miltonEventsAPI.subscribe('dataset.ready', runKpiGeneration)
    const offKpiDashboard = miltonEventsAPI.subscribe('dashboard.generate', runKpiGeneration)

    // Initial load (optional)
    fetchAndBuildCharts()

    return () => {
      offLinked()
      offReady()
      offKpiReady()
      offKpiDashboard()
    }
  }, [supabase])

  // Load KPI recipes for selected business model
  useEffect(() => {
    const stored = localStorage.getItem('businessModel')
    if (stored) {
      setBusinessModel(stored)
      getKpiRecipes(stored).then((r) => {
        setRecipes(r)
        miltonEventsAPI.publish('business.context', {
          businessModel: stored,
          recipes: r,
        })
        console.log('[DashboardLayout] Loaded KPI recipes for', stored, r)
      })
    }
  }, [])

  // Hydrate session and set sessionReady
  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await ensureSession();
      if (mounted) setSessionReady(ok);
    })();
    return () => { mounted = false; };
  }, [ensureSession]);

  // Listen to dashboard generation events, but only when sessionReady
  useEffect(() => {
    if (!sessionReady) return;
    const unsubscribe = miltonEventsAPI.subscribe('dashboard.generate', async (payload) => {
      console.log('[DashboardLayout] Dashboard generation triggered for:', payload.businessModel);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { console.warn('[DashboardLayout] No user authenticated'); return; }
        const kpis = await getUserKpiSnapshots(supabase, user.id);
        const modelRecipes = await getKpiRecipes(payload.businessModel);
        setKpiData(kpis);
        setRecipes(modelRecipes);
        miltonEventsAPI.publish('dashboard.data.ready', { kpis, recipes: modelRecipes, businessModel: payload.businessModel });
        console.log('[DashboardLayout] Dashboard data ready event published');
      } catch (err) {
        console.error('[DashboardLayout] Error generating dashboard:', err);
      }
    });
    return () => unsubscribe();
  }, [sessionReady, supabase]);

  const refreshDataStatus = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/api/data/status', {
        credentials: 'include',
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      })

      try {
        const text = await res.text()
        const json = text ? JSON.parse(text) : null
        setDataStatus(json)
      } catch (parseError) {
        console.error('Invalid JSON from /api/data/status:', parseError)
        setDataStatus(null)
      }
    } catch (error) {
      console.error('Failed to refresh data status:', error)
      setDataStatus(null)
    }
  }, []);

  useEffect(() => {
    refreshDataStatus()
  }, [refreshDataStatus]);

  // Listen for custom event to force-refresh data status when uploads complete
  useEffect(() => {
    const handler = () => refreshDataStatus()
    window.addEventListener('data-status:refresh', handler)
    return () => window.removeEventListener('data-status:refresh', handler)
  }, [refreshDataStatus])

  useEffect(() => {
    console.log('Data readiness from API:', dataStatus);
  }, [dataStatus]);

  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname?.startsWith('/dashboard')) return;       // ignore non-dashboard routes

    if (pathname.startsWith('/dashboard/model')) return;   // skip redirect for Data Model Builder and subpaths

    if (
      dataStatus?.ok &&
      !dataStatus.bank &&
      !dataStatus.crm &&
      !dataStatus.budget
    ) {
      console.log('Redirecting user to /dashboard due to missing data...');
      router.replace('/dashboard');
    }
  }, [pathname, dataStatus, router]);

  return (
    <DataStatusProvider value={{ refreshDataStatus }}>
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        {children}
        {/* Optional insight preview - removed to prevent duplication */}
        {/* (Optional) Add debug display for live KPI chart data */}
        {/* <pre>{JSON.stringify(chartData, null, 2)}</pre> */}
      {/* Chat Toggle Button */}
      <button
        aria-label="Open Milton Chat"
        onClick={() => setIsChatOpen((open) => !open)}
        style={{
          position: 'fixed',
          right: 32,
          bottom: 32,
          zIndex: 10050,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: 'none',
          fontSize: 28,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        💬
      </button>
      {/* Sliding Chat Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: '33.333vw',
          maxWidth: 420,
          minWidth: 320,
          background: '#fff',
          boxShadow: '0 0 24px rgba(0,0,0,0.2)',
          zIndex: 10000,
          transform: isChatOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(.4,0,.2,1)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="chat-panel" style={{ position: 'relative' }}>
          <MiltonChat />
        </div>
      </div>
      </div>
    </DataStatusProvider>
  );
};

export default DashboardLayout;