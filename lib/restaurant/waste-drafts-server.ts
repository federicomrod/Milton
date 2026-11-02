// lib/restaurant/waste-drafts-server.ts
//
// #408 · turns a waste report (Telegram or app, text or voice transcript) into
// DRAFT lines in kitchen_waste_lines. Service role, best effort: it never
// throws into the message pipeline, does nothing when the table (077) is not
// there, and never writes a value: drafts are for a manager to confirm.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runChat } from "@/lib/ai/call";
import { suggestIngredient } from "@/lib/restaurant/kitchen-ingredient-match";
import {
  WASTE_DRAFT_PROMPT,
  parseWasteDrafts,
} from "@/lib/restaurant/waste-drafts";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { localKitchenInstant } from "@/lib/restaurant/kitchen-attention";

export async function draftWasteLines(input: {
  admin: SupabaseClient;
  companyId: string;
  locationId: string;
  text: string;
  /** The report row, when known; otherwise found by its Telegram ids. */
  reportId?: string | null;
  chatId?: number;
  messageId?: number;
}): Promise<{ drafted: number }> {
  try {
    const text = input.text.trim().slice(0, 2000);
    if (!text) return { drafted: 0 };
    const { admin, companyId } = input;

    let reportId = input.reportId ?? null;
    let createdAt: string | null = null;
    const base = admin
      .from("kitchen_reports")
      .select("id, created_at")
      .eq("company_id", companyId);
    const found = reportId
      ? await base.eq("id", reportId).maybeSingle()
      : input.chatId != null && input.messageId != null
        ? await base
            .eq("telegram_chat_id", input.chatId)
            .eq("telegram_message_id", input.messageId)
            .maybeSingle()
        : { data: null };
    if (found.data) {
      reportId = found.data.id as string;
      createdAt = found.data.created_at as string;
    }
    if (!reportId) return { drafted: 0 };

    // One reading per report: a retry never doubles the lines.
    const existing = await admin
      .from("kitchen_waste_lines")
      .select("id")
      .eq("report_id", reportId)
      .limit(1);
    if (existing.error || (existing.data?.length ?? 0) > 0)
      return { drafted: 0 };

    const ai = await runChat({
      feature: "waste-drafts",
      companyId,
      params: {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: WASTE_DRAFT_PROMPT },
          { role: "user", content: text },
        ],
      },
    });
    if (!ai.ok) return { drafted: 0 };
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(ai.value.choices[0]?.message?.content ?? "null");
    } catch {
      return { drafted: 0 };
    }
    const drafts = parseWasteDrafts(parsed);
    if (!drafts.length) return { drafted: 0 };

    const [{ data: ingredients }, tz] = await Promise.all([
      admin
        .from("ingredients")
        .select("id, name")
        .eq("company_id", companyId)
        .limit(5000),
      resolvePosTimezone(admin, companyId),
    ]);
    const catalog = (ingredients ?? []) as Array<{ id: string; name: string }>;
    const reportDate = localKitchenInstant(
      createdAt ?? new Date().toISOString(),
      tz
    ).dateKey;

    const rows = drafts.map((d) => ({
      company_id: companyId,
      report_id: reportId,
      location_id: input.locationId,
      item_name: d.item,
      ingredient_id: suggestIngredient(d.item, catalog)?.ingredient.id ?? null,
      quantity: d.quantity,
      unit: d.unit,
      report_date: reportDate,
      status: "draft",
      source: "ai",
    }));
    const { error } = await admin.from("kitchen_waste_lines").insert(rows);
    if (error) return { drafted: 0 };
    return { drafted: rows.length };
  } catch {
    // A best-effort reading: the report itself is already stored.
    return { drafted: 0 };
  }
}
