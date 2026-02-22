import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeFieldValues,
  type NormalizeFieldRequest,
} from "@/lib/ai/normalize-values";

export const dynamic = "force-dynamic";

interface NormalizeRequest {
  fields: NormalizeFieldRequest[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: NormalizeRequest = await req.json();

    if (
      !body.fields ||
      !Array.isArray(body.fields) ||
      body.fields.length === 0
    ) {
      return NextResponse.json(
        { error: "fields array is required" },
        { status: 400 }
      );
    }

    const result = await normalizeFieldValues(body.fields);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[normalize-values] Error:", error);
    const msg = error instanceof Error ? error.message : "Normalization failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
