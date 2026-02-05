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
    // Find templates that suggest this metric
    const { data: templates, error: templatesError } = await supabase
      .from("business_model_templates")
      .select("key, name, suggested_metrics");

    if (templatesError) throw templatesError;

    const referencingTemplates = templates?.filter((template) => {
      const metrics = template.suggested_metrics as string[];
      return metrics && metrics.includes(id);
    });

    // Find companies using this metric
    const { data: businessModels, error: modelsError } = await supabase
      .from("business_models")
      .select("id, metrics");

    if (modelsError) throw modelsError;

    const companiesUsing = businessModels?.filter((model) => {
      const metrics = model.metrics as string[];
      return metrics && metrics.includes(id);
    });

    return NextResponse.json({
      referencingTemplates: referencingTemplates || [],
      companiesUsing: companiesUsing?.length || 0,
    });
  } catch (error: any) {
    console.error("Error fetching metric impact:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch impact data" },
      { status: 500 }
    );
  }
}
