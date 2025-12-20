// app/api/onboarding/kpi-preferences/route.ts
// API for saving and loading user's selected KPIs

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BusinessTypeId } from "@/lib/business-types";

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Get company for user
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("business_models")
    .select("selected_kpi_ids, business_type, model_json, suggested_kpis")
    .eq("company_id", company.id)
    .single();

  if (error) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    selectedKpiIds: (data.selected_kpi_ids ?? []) as string[],
    businessType: (data.business_type ?? "saas") as BusinessTypeId,
    modelJson: data.model_json ?? null,
    suggestedKpis: (data.suggested_kpis ?? []) as any[],
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const selectedKpiIds = Array.isArray(body?.selectedKpiIds)
    ? (body.selectedKpiIds as string[])
    : [];

  // Get company for user
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("business_models")
    .update({ selected_kpi_ids: selectedKpiIds })
    .eq("company_id", company.id);

  if (error) {
    console.error("[kpi-preferences] update error", error);
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
