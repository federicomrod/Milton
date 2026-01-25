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

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();
    const companyId = company?.id ?? null;

    // Only check model_data since legacy tables are replaced
    const { count: modelDataCount, error: modelDataError } = companyId
      ? await supabase
          .from("model_data")
          .select("*", { count: "exact" })
          .eq("company_id", companyId)
      : { count: 0, error: null };

    if (modelDataError) {
      return NextResponse.json({
        ok: false,
        hasModelData: false,
      });
    }

    // DEV fallback: detect orphaned model_data
    if (process.env.NODE_ENV === "development") {
      const { count: globalModelDataCount } = await supabase
        .from("model_data")
        .select("*", { count: "exact" });
      if ((modelDataCount ?? 0) === 0 && (globalModelDataCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global model data rows without company attribution"
        );
      }
    }

    return NextResponse.json({
      ok: true,
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
