// GET /api/analytics/fitness-studio/kpis?from_date=...&to_date=...
// Returns KPI values for fitness studio using the unified kpi-calculations layer.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateActiveMembers,
  calculateNewMonthlyMembers,
  calculateChurnedMonthlyMembers,
  calculateMonthlyChurnRate,
  calculateAverageMemberTenure,
  calculateRevenuePerMember,
  calculateUtilizationRate,
  calculateCancellationRate,
  calculateTotalRevenue,
  calculateTotalExpenses,
  calculateNetIncome,
  calculateBurnRate,
  calculateRevenuePerClass,
} from "@/lib/kpi-calculations";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest) {
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
      return jsonNoStore({ kpis: {} });
    }

    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];

    const [
      activeMembersRes,
      newMembersRes,
      churnedMembersRes,
      churnRateRes,
      avgTenureRes,
      revenuePerMemberRes,
      utilizationRateRes,
      cancellationRateRes,
      totalRevenueRes,
      totalExpensesRes,
      netIncomeRes,
      burnRateRes,
      revenuePerClassRes,
    ] = await Promise.all([
      calculateActiveMembers(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
        historicalData: [] as { period: string; value: number }[],
      })),
      calculateNewMonthlyMembers(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateChurnedMonthlyMembers(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateMonthlyChurnRate(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateAverageMemberTenure(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateRevenuePerMember(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateUtilizationRate(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateCancellationRate(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
      calculateTotalRevenue(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
        historicalData: [] as { period: string; value: number }[],
      })),
      calculateTotalExpenses(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
        historicalData: [] as { period: string; value: number }[],
      })),
      calculateNetIncome(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
        historicalData: [] as { period: string; value: number }[],
      })),
      calculateBurnRate(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
        historicalData: [] as { period: string; value: number }[],
      })),
      calculateRevenuePerClass(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0, historicalData: [] })
      ),
    ]);

    // Total revenue: prefer orders/invoices (layer); fallback to transactions-derived (revenuePerMember * activeMembers) for fitness studios with only transaction data
    const ordersRevenue = totalRevenueRes.currentValue ?? 0;
    const activeMembers = activeMembersRes.currentValue ?? 0;
    const revenuePerMember = revenuePerMemberRes.currentValue ?? 0;
    const totalRevenue =
      ordersRevenue > 0 ? ordersRevenue : revenuePerMember * activeMembers;

    const totalCosts = totalExpensesRes.currentValue ?? 0;
    const netIncome = netIncomeRes.currentValue ?? 0;

    return jsonNoStore({
      kpis: {
        activeMembers: activeMembersRes.currentValue ?? 0,
        newMembers: newMembersRes.currentValue ?? 0,
        churnedMembers: churnedMembersRes.currentValue ?? 0,
        churnRate: parseFloat(
          Number(churnRateRes.currentValue ?? 0).toFixed(2)
        ),
        avgTenure: parseFloat(
          Number(avgTenureRes.currentValue ?? 0).toFixed(1)
        ),
        revenuePerMember: parseFloat(
          Number(revenuePerMemberRes.currentValue ?? 0).toFixed(2)
        ),
        utilizationRate: parseFloat(
          Number(utilizationRateRes.currentValue ?? 0).toFixed(2)
        ),
        cancellationRate: parseFloat(
          Number(cancellationRateRes.currentValue ?? 0).toFixed(2)
        ),
        totalRevenue: parseFloat(Number(totalRevenue).toFixed(2)),
        totalCosts: parseFloat(Number(totalCosts).toFixed(2)),
        netIncome: parseFloat(Number(netIncome).toFixed(2)),
        burnRate: parseFloat(Number(burnRateRes.currentValue ?? 0).toFixed(2)),
        revenuePerClass: parseFloat(
          Number(revenuePerClassRes.currentValue ?? 0).toFixed(2)
        ),
      },
    });
  } catch (err) {
    console.error("[api/analytics/fitness-studio/kpis] Unexpected error:", err);
    return jsonNoStore({ kpis: {} });
  }
}
