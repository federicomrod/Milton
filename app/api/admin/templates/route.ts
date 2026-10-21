import { createClient } from "@/lib/supabase/server";
import {
  requireMiltonStaff,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorizedResponse();

  const notStaff = await requireMiltonStaff(user.id);
  if (notStaff) return notStaff;

  try {
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("*")
      .order("name");

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error fetching templates:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorizedResponse();

  const notStaff = await requireMiltonStaff(user.id);
  if (notStaff) return notStaff;

  try {
    const body = await req.json();
    const {
      key,
      name,
      description,
      required_table_ids,
      required_relationships,
      kpi_ids,
      filters,
      mvp_guardrails,
    } = body;

    // Validation
    if (!key || !name) {
      return NextResponse.json(
        { error: "Key and name are required" },
        { status: 400 }
      );
    }

    // Check key uniqueness
    const { data: existing } = await supabase
      .from("business_model_templates")
      .select("key")
      .eq("key", key)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "A template with this key already exists" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("business_model_templates")
      .insert({
        key,
        name,
        description: description || null,
        required_table_ids: required_table_ids || [],
        required_relationships: required_relationships || [],
        kpi_ids: kpi_ids || [],
        filters: filters || [],
        mvp_guardrails: mvp_guardrails || {},
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error("Error creating template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create template" },
      { status: 500 }
    );
  }
}
