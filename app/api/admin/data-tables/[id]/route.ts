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
    const { slug, name, description, fields } = body;

    // Validation
    if (fields && (!Array.isArray(fields) || fields.length === 0)) {
      return NextResponse.json(
        { error: "Fields must be a non-empty array" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("data_tables")
      .update({
        slug,
        name,
        description: description || null,
        fields: fields || [],
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error updating data table:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update data table" },
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
    const { error } = await supabase.from("data_tables").delete().eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting data table:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete data table" },
      { status: 500 }
    );
  }
}
