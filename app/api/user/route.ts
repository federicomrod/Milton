// GET /api/user
// Returns the current authenticated user data.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ user });
  } catch (err) {
    console.error("[api/user] Unexpected error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
