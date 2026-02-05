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
    // Find templates that use this KPI
    const { data: templates, error: templatesError } = await supabase
      .from("business_model_templates")
      .select("key, name, kpi_ids");

    if (templatesError) throw templatesError;

    const referencingTemplates = templates?.filter((template) => {
      const kpiIds = template.kpi_ids as string[];
      return kpiIds && kpiIds.includes(id);
    });

    // Find companies that have selected this KPI
    const { data: businessModels, error: modelsError } = await supabase
      .from("business_models")
      .select("id, selected_kpi_ids");

    if (modelsError) throw modelsError;

    const companiesUsing = businessModels?.filter((model) => {
      const selectedKpiIds = model.selected_kpi_ids as string[];
      return selectedKpiIds && selectedKpiIds.includes(id);
    });

    return NextResponse.json({
      referencingTemplates: referencingTemplates || [],
      companiesUsing: companiesUsing?.length || 0,
    });
  } catch (error: any) {
    console.error("Error fetching KPI impact:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch impact data" },
      { status: 500 }
    );
  }
}
