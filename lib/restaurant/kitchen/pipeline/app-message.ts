// lib/restaurant/kitchen/pipeline/app-message.ts
//
// Messages sent from the Cocina app (mobile, #431) go through the SAME
// pipeline Telegram kitchen messages use: voice is transcribed, then the rules,
// the price AI and the kitchen AI read it (runMessagePipeline). Purchases and
// prices become drafts in Costos › Compras «Por revisar» (origin «por App»),
// stock alerts are stored in Cocina, and nothing is applied until a manager
// approves. Nothing is sent to Telegram: replies are captured in a reply sink
// and boiled down into app_result, which the phone shows on the card.
//
// Money: app_result keeps product names and what happened, never an amount.
// An amount question is NOT quoted back to the cook (the app uses its own
// words for it).
//
// SECURITY: logs fixed lines only, never the text, the transcript or a token.

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiUnavailableFor, runTranscription } from "@/lib/ai/call";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePreferredLanguage } from "@/lib/restaurant/language";
import { withKitchenLanguage } from "@/lib/restaurant/telegram/kitchen-language";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { joinProducts } from "@/lib/restaurant/telegram/price-flow";
import type { KitchenLink } from "@/lib/restaurant/telegram/kitchen-links";
import { tryPendingAnswer } from "@/lib/restaurant/telegram/kitchen-pending-answer";
import { runMessagePipeline } from "@/lib/restaurant/kitchen/pipeline/message-pipeline";
import {
  appChatId,
  appMessageId,
  runWithReplySink,
  type PipelineEvent,
  type ReplySink,
  type UnclearReason,
} from "@/lib/restaurant/kitchen/pipeline/reply-sink";
import { unclearReasonOf } from "@/lib/restaurant/kitchen/pipeline/unclear-reason";
import { KITCHEN_MEDIA_BUCKET } from "@/lib/restaurant/kitchen/media-storage";

export interface AppResult {
  v: 1;
  state: "processing" | "done" | "failed";
  /** A stock alert / waste report was stored in Cocina. */
  noted: boolean;
  /** A price / purchase went to Compras as a draft «Por revisar». */
  draft: boolean;
  /** Milton needs one more answer from the cook. */
  /** A unit question is rebuilt from the copy; an amount question has no text. */
  asks: { kind: "unit" | "amount"; text: string | null } | null;
  /** Why Milton could not read it: a CODE the app words itself (es/en/de), never a reply. */
  unclear: UnclearReason | null;
  /** It read like a recipe (recipe drafts from the app come later). */
  recipe: boolean;
  /** What Milton understood: product names only. */
  understood: string[];
  /** Named without a price next to priced ones: the card asks how many (names only). */
  extras: string[];
}

const EMPTY: Omit<AppResult, "state"> = {
  v: 1 as const,
  noted: false,
  draft: false,
  asks: null,
  unclear: null,
  recipe: false,
  understood: [],
  extras: [],
};

/**
 * Boils what the pipeline DID down to what the card shows. The captured replies
 * are never copied onto the result: they quote prices (an example price, or the
 * price just saved). The unit question is rebuilt from the copy with only the
 * product names, and «could not read it» is a reason code. Call it in the
 * company's kitchen language.
 */
export function summarizeSink(
  sink: Pick<ReplySink, "messages" | "events">,
  outcome: "handled" | "recipe"
): AppResult {
  const events: PipelineEvent[] = sink.events;
  const question = events.find((e) => e.kind === "question");
  const draft = events.some((e) => e.kind === "price_draft");
  const noted = events.some((e) => e.kind === "stock");
  const understood = [
    ...new Set(
      events.flatMap((e) =>
        e.kind === "price_draft" || e.kind === "stock" ? e.products : []
      )
    ),
  ].filter(Boolean);
  const extras = [
    ...new Set(events.flatMap((e) => (e.kind === "extras" ? e.products : []))),
  ].filter(Boolean);
  const nothing = !question && !draft && !noted;

  let unclear: UnclearReason | null = null;
  if (nothing && outcome === "handled") {
    const reported = events.find((e) => e.kind === "unclear");
    unclear =
      reported?.kind === "unclear"
        ? reported.reason
        : sink.messages.length > 0
          ? unclearReasonOf(sink.messages)
          : null;
  }

  return {
    ...EMPTY,
    state: "done",
    noted,
    draft,
    asks: question
      ? {
          kind: question.ask,
          text:
            question.ask === "unit" && question.products.length > 0
              ? renderKitchenCopy(KITCHEN_COPY.PRICE_UNIT_ASK, {
                  producto: joinProducts(question.products),
                })
              : null,
        }
      : null,
    unclear,
    recipe: outcome === "recipe" && nothing,
    understood,
    extras,
  };
}

type Admin = SupabaseClient;

async function saveResult(
  admin: Admin,
  reportId: string,
  companyId: string,
  result: AppResult,
  extra: Record<string, unknown> = {}
) {
  const { error } = await admin
    .from("kitchen_reports")
    .update({
      app_result: result,
      ...(result.state === "processing"
        ? {}
        : { processed_at: new Date().toISOString() }),
      ...extra,
    })
    .eq("id", reportId)
    .eq("company_id", companyId);
  return !error;
}

/** Downloads the stored voice note and transcribes it, like the Telegram path. */
async function transcribeStored(
  admin: Admin,
  companyId: string,
  path: string,
  mime: string,
  language: "es" | "en" | "de"
): Promise<{ ok: true; text: string } | { ok: false; quota: boolean }> {
  try {
    const { data, error } = await admin.storage
      .from(KITCHEN_MEDIA_BUCKET)
      .download(path);
    if (error || !data) return { ok: false, quota: false };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const file = new File([bytes], "voice.m4a", { type: mime });
    const transcription = await runTranscription({
      feature: "app-voice",
      companyId,
      timeoutMs: 20000,
      params:
        language === "es"
          ? { file, model: "whisper-1", language: "es" }
          : { file, model: "whisper-1" },
    });
    if (!transcription.ok) {
      return { ok: false, quota: aiUnavailableFor(transcription) === "quota" };
    }
    const text = (transcription.value.text ?? "").trim();
    return text ? { ok: true, text } : { ok: false, quota: false };
  } catch {
    return { ok: false, quota: false };
  }
}

/**
 * Processes one app report (text, or voice: transcribe first). Runs once per
 * report: a conditional update claims it, so a retry or a double call does
 * nothing. Never throws.
 */
export async function processAppReport(input: {
  staffId: string;
  reportId: string;
  admin?: Admin;
}): Promise<void> {
  const admin = input.admin ?? createAdminClient();
  try {
    const { data: report } = await admin
      .from("kitchen_reports")
      .select(
        "id, company_id, location_id, staff_id, text, media_kind, created_at, app_result"
      )
      .eq("id", input.reportId)
      .eq("staff_id", input.staffId)
      .maybeSingle();
    if (!report || report.app_result) return;
    const companyId = report.company_id as string;
    const locationId = report.location_id as string;
    const isVoice = report.media_kind === "voice";
    if (!isVoice && !(report.text as string | null)?.trim()) return;

    // Claim. Only one caller gets the row back.
    const { data: claimed, error: claimError } = await admin
      .from("kitchen_reports")
      .update({ app_result: { ...EMPTY, state: "processing" } })
      .eq("id", report.id as string)
      .eq("company_id", companyId)
      .is("app_result", null)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) return;

    const [company, location] = await Promise.all([
      admin
        .from("companies")
        .select("name, preferred_language")
        .eq("id", companyId)
        .maybeSingle(),
      admin
        .from("restaurant_locations")
        .select("name")
        .eq("id", locationId)
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);
    const language = resolvePreferredLanguage(company.data?.preferred_language);
    const chatId = appChatId(input.staffId);
    const messageId = appMessageId(input.reportId);
    const link: KitchenLink = {
      staffId: input.staffId,
      companyId,
      companyName: (company.data?.name as string) ?? "",
      locationId,
      locationName: (location.data?.name as string) ?? "",
      telegramUserId: chatId,
      language,
    };
    const staff = {
      id: input.staffId,
      company_id: companyId,
      company_name: link.companyName,
      location_id: locationId,
      location_name: link.locationName,
    };
    const sink: ReplySink = { chatId, messages: [], events: [] };
    const dateSec = Math.floor(
      new Date((report.created_at as string) ?? Date.now()).getTime() / 1000
    );

    await withKitchenLanguage(language, () =>
      runWithReplySink(sink, async () => {
        let text = ((report.text as string | null) ?? "").trim();

        if (isVoice) {
          const { data: media } = await admin
            .from("kitchen_media")
            .select("storage_path, mime")
            .eq("company_id", companyId)
            .eq("kitchen_report_id", report.id as string)
            .limit(1)
            .maybeSingle();
          const heard = media
            ? await transcribeStored(
                admin,
                companyId,
                media.storage_path as string,
                (media.mime as string) ?? "audio/mp4",
                language
              )
            : ({ ok: false, quota: false } as const);
          if (!heard.ok) {
            // A code, not Telegram's sentence; the voice note itself is kept.
            sink.events.push({
              kind: "unclear",
              reason: heard.quota ? "ai_unavailable" : "unreadable",
            });
            await saveResult(
              admin,
              input.reportId,
              companyId,
              summarizeSink(sink, "handled")
            );
            return;
          }
          text = heard.text;
          await admin
            .from("kitchen_reports")
            .update({ transcript: text.slice(0, 2000) })
            .eq("id", input.reportId)
            .eq("company_id", companyId);
        }

        const origin = isVoice ? ("voice" as const) : ("text" as const);

        // An answer to a question Milton asked before is tried FIRST, exactly
        // like a Telegram answer.
        const answered = await tryPendingAnswer({
          text,
          chatId,
          messageId,
          dateSec,
          links: [link],
          origin,
          prepareReport: async () => ({ reportId: input.reportId }),
          getMarkup: async () => undefined,
          run: (fn) => fn().then(() => undefined),
        });

        let outcome: "handled" | "recipe" = "handled";
        if (answered.kind !== "handled") {
          outcome = await runMessagePipeline(text, {
            admin: admin as never,
            staff,
            link,
            chatId,
            messageId,
            reportId: input.reportId,
            dateSec,
            origin,
            len: text.length,
          });
        }
        await saveResult(
          admin,
          input.reportId,
          companyId,
          summarizeSink(sink, outcome)
        );
      })
    );
  } catch (err) {
    console.error(
      "[app-message] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    try {
      const { data: row } = await admin
        .from("kitchen_reports")
        .select("company_id")
        .eq("id", input.reportId)
        .eq("staff_id", input.staffId)
        .maybeSingle();
      if (row) {
        await saveResult(admin, input.reportId, row.company_id as string, {
          ...EMPTY,
          state: "failed",
        });
      }
    } catch {
      // Nothing more to do.
    }
  }
}

/** Runs the processing after the response is sent (inline when there is no request scope). */
export function scheduleAppProcessing(input: {
  staffId: string;
  reportId: string;
}): void {
  const run = () => processAppReport(input);
  try {
    after(run);
  } catch {
    void run();
  }
}
