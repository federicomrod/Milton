import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    // Get the data table
    const { data: dataTable, error: dataTableError } = await supabase
      .from("data_tables")
      .select("slug, business_model_template_key")
      .eq("id", id)
      .single();

    if (dataTableError) {
      throw dataTableError;
    }

    // Find which templates reference this table
    const { data: templates, error: templatesError } = await supabase
      .from("business_model_templates")
      .select("key, name, required_table_ids");

    if (templatesError) {
      throw templatesError;
    }

    const referencingTemplates = templates?.filter((template) =>
      template.required_table_ids?.includes(id)
    );

    // Check if any company's canonical_model uses this table
    const { data: companies, error: companiesError } = await supabase
      .from("business_models")
      .select("id, canonical_model");

    if (companiesError) {
      throw companiesError;
    }

    const companiesUsing = companies?.filter((company) => {
      const model = company.canonical_model as any;
      if (!model || !model.tables) return false;
      return model.tables.some(
        (table: any) =>
          table.name === dataTable.slug || table.slug === dataTable.slug
      );
    });

    return NextResponse.json({
      referencingTemplates: referencingTemplates || [],
      companiesUsing: companiesUsing?.length || 0,
    });
  } catch (error: any) {
    console.error("Error fetching data table impact:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch impact data" },
      { status: 500 }
    );
  }
}
