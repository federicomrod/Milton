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

    // Find templates that reference this table by ID
    const { data: templates, error: templatesError } = await supabase
      .from("business_model_templates")
      .select("key, name, required_table_ids");

    if (templatesError) {
      console.error("Error fetching templates for data table:", templatesError);
      throw templatesError;
    }

    // Filter templates that contain this table ID
    const filteredTemplates =
      templates
        ?.filter(
          (template) =>
            Array.isArray(template.required_table_ids) &&
            template.required_table_ids.includes(id)
        )
        .map((template) => ({
          key: template.key,
          name: template.name,
        })) || [];

    return NextResponse.json(filteredTemplates);
  } catch (error: any) {
    console.error("Error fetching templates for data table:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch templates" },
      { status: 500 }
    );
  }
}
