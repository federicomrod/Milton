import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("*")
      .order("name");

    if (error) throw error;

    // Transform required_tables_data to required_table_ids for frontend compatibility
    const transformedData = data?.map((template: any) => ({
      ...template,
      required_table_ids: template.required_tables_data || [],
    }));

    return NextResponse.json(transformedData);
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
      data_categories,
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
        required_tables_data: required_table_ids || [],
        required_relationships: required_relationships || [],
        kpi_ids: kpi_ids || [],
        filters: filters || [],
        mvp_guardrails: mvp_guardrails || {},
        data_categories: data_categories || [],
      })
      .select()
      .single();

    if (error) throw error;

    // Transform required_tables_data to required_table_ids for frontend compatibility
    const transformedData = {
      ...data,
      required_table_ids: data.required_tables_data || [],
    };

    return NextResponse.json(transformedData, { status: 201 });
  } catch (error: any) {
    console.error("Error creating template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create template" },
      { status: 500 }
    );
  }
}
