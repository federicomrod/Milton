// app/api/mobile/v1/kitchen/history/route.ts
//
// GET: the cook's own latest reports, newest first, ?cursor= for older ones.
// Only this cook's rows (company + staff + location filters), serialized
// through the allow-list: no money, never another cook's items.

import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import { serializeKitchenHistoryItem } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 30;

function decodeCursor(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const iso = Buffer.from(raw, "base64url").toString("utf8");
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff, companyId, locationIds } = auth;

  const rawCursor = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) {
    return kitchenJson({ error: "El cursor no es válido." }, 400);
  }

  try {
    let query = admin
      .from("kitchen_reports")
      .select(
        "id, media_kind, media_mime, text, transcript, processed_at, created_at"
      )
      .eq("company_id", companyId)
      .eq("staff_id", staff.id)
      .in("location_id", locationIds)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) {
      return kitchenJson({ error: "No pude cargar tu historial." }, 500);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > PAGE_SIZE && last
        ? Buffer.from(String(last.created_at), "utf8").toString("base64url")
        : null;
    return kitchenJson({
      items: page.map((r) => serializeKitchenHistoryItem(r)),
      nextCursor,
    });
  } catch (err) {
    console.error(
      "[mobile-kitchen-history] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: "No pude cargar tu historial." }, 500);
  }
}
