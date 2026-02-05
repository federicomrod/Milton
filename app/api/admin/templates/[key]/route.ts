import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
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
    const { key } = await params;
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("*")
      .eq("key", key)
      .single();

    if (error) throw error;

    // Transform required_tables_data to required_table_ids for frontend compatibility
    const transformedData = {
      ...data,
      required_table_ids: data.required_tables_data || [],
    };

    return NextResponse.json(transformedData);
  } catch (error: any) {
    console.error("Error fetching template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch template" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
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
    const { key } = await params;
    const body = await req.json();
    const {
      name,
      description,
      required_table_ids,
      required_relationships,
      kpi_ids,
      filters,
      mvp_guardrails,
      data_categories,
      suggested_metrics,
    } = body;

    const { data, error } = await supabase
      .from("business_model_templates")
      .update({
        name,
        description: description || null,
        required_tables_data: required_table_ids,
        required_relationships,
        kpi_ids,
        filters,
        mvp_guardrails,
        data_categories,
        suggested_metrics,
      })
      .eq("key", key)
      .select()
      .single();

    if (error) throw error;

    // Transform required_tables_data to required_table_ids for frontend compatibility
    const transformedData = {
      ...data,
      required_table_ids: data.required_tables_data || [],
    };

    return NextResponse.json(transformedData);
  } catch (error: any) {
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update template" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
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
    const { key } = await params;
    const { error } = await supabase
      .from("business_model_templates")
      .delete()
      .eq("key", key);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete template" },
      { status: 500 }
    );
  }
}
