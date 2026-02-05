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
      .from("kpis")
      .select("*")
      .order("name");

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error fetching KPIs:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch KPIs" },
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
      name,
      definition,
      required_data,
      flexibility,
      formula,
      is_published,
      notes,
    } = body;

    // Validation
    if (!name || !definition) {
      return NextResponse.json(
        { error: "Name and definition are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("kpis")
      .insert({
        name,
        definition,
        required_data: required_data || [],
        flexibility: flexibility || {},
        formula: formula || null,
        is_published: is_published || false,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error("Error creating KPI:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create KPI" },
      { status: 500 }
    );
  }
}
