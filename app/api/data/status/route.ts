import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") ?? undefined;
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");

    // createClient expects cookies, not a token. Provide no argument, use global auth.
    const supabase = await createClient();

    // Set the access token manually if present, before accessing user session
    if (accessToken) {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: "",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json({
          ok: true,
          bank: true,
          crm: true,
          budget: true,
        });
      }
      return NextResponse.json({
        ok: true,
        bank: false,
        crm: false,
        budget: false,
      });
    }

    const userId = user.id;

    let [
      { count: bankCount, error: bankError },
      { count: crmCount, error: crmError },
      { count: budgetCount, error: budgetError },
      { count: modelDataCount, error: modelDataError },
    ] = await Promise.all([
      supabase
        .from("transactions")
        .select("*", { count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("crm_deals")
        .select("*", { count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("budgets")
        .select("*", { count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("user_model_data")
        .select("*", { count: "exact" })
        .eq("user_id", userId),
    ]);

    if (bankError || crmError || budgetError || modelDataError) {
      return NextResponse.json({
        ok: false,
        bank: false,
        crm: false,
        budget: false,
        hasModelData: false,
      });
    }

    // DEV fallback: detect orphaned data and still report readiness
    if (process.env.NODE_ENV === "development") {
      const [
        { count: globalBankCount },
        { count: globalCrmCount },
        { count: globalBudgetCount },
        { count: globalModelDataCount },
      ] = await Promise.all([
        supabase.from("transactions").select("*", { count: "exact" }),
        supabase.from("crm_deals").select("*", { count: "exact" }),
        supabase.from("budgets").select("*", { count: "exact" }),
        supabase.from("user_model_data").select("*", { count: "exact" }),
      ]);
      if ((bankCount ?? 0) === 0 && (globalBankCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global transaction rows without user attribution"
        );
        bankCount = globalBankCount;
      }
      if ((crmCount ?? 0) === 0 && (globalCrmCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global CRM rows without user attribution"
        );
        crmCount = globalCrmCount;
      }
      if ((budgetCount ?? 0) === 0 && (globalBudgetCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global budget rows without user attribution"
        );
        budgetCount = globalBudgetCount;
      }
      if ((modelDataCount ?? 0) === 0 && (globalModelDataCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global model data rows without user attribution"
        );
        modelDataCount = globalModelDataCount;
      }
    }

    return NextResponse.json({
      ok: true,
      bank: (bankCount ?? 0) > 0,
      crm: (crmCount ?? 0) > 0,
      budget: (budgetCount ?? 0) > 0,
      hasModelData: (modelDataCount ?? 0) > 0,
    });
  } catch (err: any) {
    console.error("❌ /api/data/status failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Unexpected server error",
        bank: false,
        crm: false,
        budget: false,
      },
      { status: 500 }
    );
  }
}
