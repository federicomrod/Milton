import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
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
    const body = await req.json();
    const { slug, name, description, category } = body;

    // Validation
    if (category && !["core", "ltm", "advanced"].includes(category)) {
      return NextResponse.json(
        { error: "Category must be core, ltm, or advanced" },
        { status: 400 }
      );
    }

    // Check slug uniqueness (if changing slug)
    if (slug) {
      const { data: existing } = await supabase
        .from("metrics")
        .select("id")
        .eq("slug", slug)
        .neq("id", id)
        .single();

      if (existing) {
        return NextResponse.json(
          { error: "A metric with this slug already exists" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("metrics")
      .update({
        slug,
        name,
        description: description || null,
        category,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error updating metric:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update metric" },
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { error } = await supabase.from("metrics").delete().eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting metric:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete metric" },
      { status: 500 }
    );
  }
}
