import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { NextRequest, NextResponse } from "next/server";
import { createDataTable, getDataTables } from "@/lib/data-table-service";

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
    const dataTables = await getDataTables();
    return NextResponse.json(dataTables);
  } catch (error: any) {
    console.error("Error fetching data tables:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch data tables" },
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
    const { slug, name, description, fields, business_model_template_key } =
      body;

    // Validation
    if (!slug || !name || !fields || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: "Missing required fields: slug, name, fields" },
        { status: 400 }
      );
    }

    if (fields.length === 0) {
      return NextResponse.json(
        { error: "At least one field is required" },
        { status: 400 }
      );
    }

    const dataTable = await createDataTable({
      slug,
      name,
      description,
      fields,
      business_model_template_key,
    });

    return NextResponse.json(dataTable, { status: 201 });
  } catch (error: any) {
    console.error("Error creating data table:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create data table" },
      { status: 500 }
    );
  }
}
