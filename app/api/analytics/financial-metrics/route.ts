// POST /api/analytics/financial-metrics
// Returns financial KPIs from the unified kpi-calculations layer (transactions + orders).
// Used by the Financials tab so it shows data when transaction/order data exists,
// regardless of which KPIs the user has selected in settings.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateNetIncome,
  calculateTotalRevenue,
  calculateTotalExpenses,
  calculateMRR,
  calculateGrossMargin,
} from "@/lib/kpi-calculations";
import { getModelDataRows } from "@/lib/kpi-calculations/getModelDataRows";

function previousPeriod(
  fromDate: string,
  toDate: string
): { from: string; to: string } {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days = Math.round(
    (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
  );
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days);
  return {
    from: prevFrom.toISOString().split("T")[0],
    to: prevTo.toISOString().split("T")[0],
  };
}

const FTE_FIELD_NAMES = [
  "fte",
  "FTE",
  "headcount",
  "Headcount",
  "count",
  "employees",
  "Employees",
  "full_time_equivalents",
  "full time equivalents",
];

function parseFteFromRow(row: Record<string, unknown>): number | null {
  for (const key of Object.keys(row)) {
    if (
      !FTE_FIELD_NAMES.some((f) => key.toLowerCase().includes(f.toLowerCase()))
    )
      continue;
    const v = row[key];
    if (v == null) continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return null;
}

function parseEmployeesOnboarding(
  employees: string | undefined
): number | null {
  if (!employees || typeof employees !== "string") return null;
  const s = employees.trim();
  const single = /^\d+$/.exec(s);
  if (single) return Math.max(1, parseInt(single[0], 10));
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
  if (range)
    return Math.round((parseInt(range[1], 10) + parseInt(range[2], 10)) / 2);
  const plus = /^(\d+)\s*\+?$/.exec(s);
  if (plus) return Math.max(1, parseInt(plus[1], 10));
  return null;
}

async function getFteCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string
): Promise<number | null> {
  const rows = await getModelDataRows(
    supabase,
    companyId,
    "employees",
    "headcount",
    "team",
    "staff",
    "workforce"
  );
  if (rows.length > 0) {
    let total = 0;
    let hasFteField = false;
    for (const row of rows) {
      const d =
        row && typeof row === "object"
          ? (row as Record<string, unknown>)
          : null;
      if (!d) continue;
      const fte = parseFteFromRow(d);
      if (fte != null) {
        total += fte;
        hasFteField = true;
      }
    }
    if (hasFteField) return Math.round(total);
    return Math.max(1, rows.length);
  }
  const { data: bm } = await supabase
    .from("business_models")
    .select("onboarding_answers")
    .eq("company_id", companyId)
    .maybeSingle();
  const answers =
    (bm?.onboarding_answers as { employees?: string } | null) ?? null;
  return parseEmployeesOnboarding(answers?.employees ?? undefined);
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { error: "company_not_found", calculatedKpis: [] },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const fromDate =
      body.from_date ||
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    const toDate = body.to_date || new Date().toISOString().split("T")[0];

    const [netIncome, totalRevenue, totalExpenses, mrr, grossMargin] =
      await Promise.all([
        calculateNetIncome(supabase, user.id, fromDate, toDate).catch(() => ({
          currentValue: null as number | null,
          historicalData: [] as { period: string; value: number }[],
        })),
        calculateTotalRevenue(supabase, user.id, fromDate, toDate).catch(
          () => ({
            currentValue: null as number | null,
            historicalData: [] as { period: string; value: number }[],
          })
        ),
        calculateTotalExpenses(supabase, user.id, fromDate, toDate).catch(
          () => ({
            currentValue: null as number | null,
            historicalData: [] as { period: string; value: number }[],
          })
        ),
        calculateMRR(supabase, user.id, fromDate, toDate).catch(() => ({
          currentValue: 0,
          historicalData: [] as { period: string; value: number }[],
        })),
        calculateGrossMargin(supabase, user.id, fromDate, toDate).catch(() => ({
          currentValue: null as number | null,
          historicalData: [] as { period: string; value: number }[],
        })),
      ]);

    const prev = previousPeriod(fromDate, toDate);
    const prevRevenueRes = await calculateTotalRevenue(
      supabase,
      user.id,
      prev.from,
      prev.to
    ).catch(() => ({ currentValue: null as number | null }));
    const prevRevenue = prevRevenueRes.currentValue ?? 0;
    const currentRev = totalRevenue.currentValue ?? 0;
    const revenueGrowthRate =
      prevRevenue > 0 && currentRev != null
        ? Math.round(((currentRev - prevRevenue) / prevRevenue) * 1000) / 10
        : null;

    const fteCount = await getFteCount(supabase, company.id);
    const revenuePerFte =
      fteCount != null &&
      fteCount > 0 &&
      totalRevenue.currentValue != null &&
      totalRevenue.currentValue > 0
        ? Math.round((totalRevenue.currentValue / fteCount) * 100) / 100
        : null;

    const monthsInPeriod = Math.max(
      1,
      Math.round(
        (new Date(toDate).getTime() - new Date(fromDate).getTime()) /
          (30.44 * 24 * 60 * 60 * 1000)
      )
    );
    const mrrDisplay =
      mrr.currentValue > 0
        ? mrr.currentValue
        : (totalRevenue.currentValue ?? 0) > 0
          ? Math.round(
              ((totalRevenue.currentValue ?? 0) / monthsInPeriod) * 100
            ) / 100
          : 0;

    const calculatedKpis = [
      {
        id: "financial-total-revenue",
        name: "Total Revenue",
        currentValue: totalRevenue.currentValue,
        historicalData: totalRevenue.historicalData ?? [],
      },
      {
        id: "financial-mrr",
        name: "Monthly Recurring Revenue (MRR)",
        currentValue: mrrDisplay,
        historicalData: mrr.currentValue > 0 ? (mrr.historicalData ?? []) : [],
      },
      {
        id: "financial-revenue-growth-rate",
        name: "Revenue Growth Rate",
        currentValue: revenueGrowthRate,
        historicalData: [] as { period: string; value: number }[],
      },
      {
        id: "financial-total-expenses",
        name: "Total Expenses",
        currentValue: totalExpenses.currentValue,
        historicalData: totalExpenses.historicalData ?? [],
      },
      {
        id: "financial-net-income",
        name: "Net Income",
        currentValue: netIncome.currentValue,
        historicalData: netIncome.historicalData ?? [],
      },
      {
        id: "financial-revenue-per-fte",
        name: "Revenue per FTE",
        currentValue: revenuePerFte,
        historicalData: [] as { period: string; value: number }[],
      },
      {
        id: "financial-gross-margin",
        name: "Gross Margin",
        currentValue: grossMargin.currentValue,
        historicalData: grossMargin.historicalData ?? [],
      },
    ];

    return NextResponse.json({ calculatedKpis });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", calculatedKpis: [] },
      { status: 500 }
    );
  }
}
