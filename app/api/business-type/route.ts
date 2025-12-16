import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { businessType } = await req.json();

    if (!businessType || typeof businessType !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid businessType" },
        { status: 400 },
      );
    }

    // Validate businessType is one of the allowed values
    const validTypes = ["saas", "agency", "fitness_studio"];
    if (!validTypes.includes(businessType)) {
      return NextResponse.json(
        { success: false, error: "Invalid businessType value" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 },
      );
    }

    const userId = user.id;

    // First, try to update existing rows for this user
    const { data: updateData, error: updateError } = await supabase
      .from("business_models")
      .update({ business_type: businessType })
      .eq("user_id", userId)
      .select("id");

    if (updateError) {
      console.error("[business-type] update error", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to update business_models" },
        { status: 500 },
      );
    }

    if (!updateData || updateData.length === 0) {
      // No existing model for this user – insert a minimal row
      const { error: insertError } = await supabase
        .from("business_models")
        .insert({
          user_id: userId,
          business_type: businessType,
          // other fields like model_json can be left as defaults/null for now
        });

      if (insertError) {
        console.error("[business-type] insert error", insertError);
        return NextResponse.json(
          { success: false, error: "Failed to insert business_models" },
          { status: 500 },
        );
      }
    }

    console.log(
      `[business-type] Successfully persisted businessType="${businessType}" for user ${userId}`,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[business-type] unexpected error", err);
    return NextResponse.json(
      { success: false, error: "Unexpected error" },
      { status: 500 },
    );
  }
}
