import { createClient } from "@/lib/supabase/server";
import {
  requireMiltonStaff,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorizedResponse();

  const notStaff = await requireMiltonStaff(user.id);
  if (notStaff) return notStaff;

  try {
    const { id } = await params;
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

    const { data, error } = await supabase
      .from("kpis")
      .update({
        name,
        definition,
        required_data: required_data || [],
        flexibility: flexibility || {},
        formula: formula || null,
        is_published: is_published ?? false,
        notes: notes || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error updating KPI:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update KPI" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorizedResponse();

  const notStaff = await requireMiltonStaff(user.id);
  if (notStaff) return notStaff;

  try {
    const { id } = await params;
    const { error } = await supabase.from("kpis").delete().eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting KPI:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete KPI" },
      { status: 500 }
    );
  }
}
