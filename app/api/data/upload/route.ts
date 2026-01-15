// app/api/data/upload/route.ts
// Thin wrapper that delegates to unified ingestion service
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestUploadedFile } from "@/lib/ingestion/ingestion-service";
import { ColumnMapping } from "@/types/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const datasetType = formData.get("datasetType") as string;
    const mode = (formData.get("mode") as string) || "append";
    const mappingsJson = formData.get("mappings") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No valid file uploaded" },
        { status: 400 }
      );
    }

    if (!datasetType || !["bank", "crm", "budget"].includes(datasetType)) {
      return NextResponse.json(
        { error: "Invalid datasetType" },
        { status: 400 }
      );
    }

    // Parse column mappings if provided
    let columnMappings: ColumnMapping[] | undefined;
    if (mappingsJson) {
      try {
        columnMappings = JSON.parse(mappingsJson) as ColumnMapping[];
      } catch (e) {
        console.error("[Upload API] Failed to parse mappings:", e);
      }
    }

    // Delegate to unified ingestion service
    const result = await ingestUploadedFile({
      supabase,
      userId: user.id,
      file,
      datasetType: datasetType as "bank" | "crm" | "budget",
      mode: mode as "overwrite" | "append",
      columnMappings,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Upload failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      datasetType: result.datasetType,
      insertedCount: result.insertedCount,
    });
  } catch (error: any) {
    console.error("[Upload API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
