// app/api/telegram/webhook/route.ts
//
// POST /api/telegram/webhook
//
// Receives Telegram Bot API updates. This endpoint is called BY Telegram,
// not by an authenticated Milton user — there is no Milton session to
// check, so authAndCompany() does not apply here. Instead, every request
// MUST carry the X-Telegram-Bot-Api-Secret-Token header matching the
// server-only TELEGRAM_WEBHOOK_SECRET (configured via Telegram's
// setWebhook call — see the manual setup notes in the implementation
// report). Any request missing or failing that check is rejected before
// any other processing, using a constant-time comparison.
//
// Handles: (1) a manager `/start <code>` message, completing the pairing
// flow started by POST /api/restaurant/telegram/pairing-code; (2) kitchen
// QR joins, `/start kq1_<secret>` from a PRIVATE chat (R1 #55); and (3)
// cook reports — text, voice notes or photos from an active kitchen_staff
// member (R1 #49), answered with one minimal Spanish acknowledgement.
// Everything else is acknowledged with 200 and ignored. Dispatch order:
// kitchen payload first, then the unchanged manager pairing path.
//
// SECURITY: never logs the webhook secret, never logs a raw pairing code
// value, never reveals which company (if any) a chat_id or code
// belongs/belonged to on a failed pairing attempt — every failure branch
// replies with a generic, bilingual, identity-free message.

import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumePairingCode } from "@/lib/restaurant/telegram/pairing";
import {
  answerCallbackQuery,
  editMessageText,
  sendTelegramMessage,
  type InlineKeyboardMarkup,
} from "@/lib/restaurant/telegram/send";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import {
  isActiveIngredient,
  loadCompanyIngredients,
} from "@/lib/restaurant/ingredient-active";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { resolvePreferredLanguage, t } from "@/lib/restaurant/language";
import { isValidWebhookSecret } from "@/lib/restaurant/telegram/webhook-secret";
import {
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";
import {
  buildDisplayName,
  consumeKitchenJoin,
  isKitchenPayload,
} from "@/lib/restaurant/telegram/kitchen-join";
import {
  destinationVars,
  KITCHEN_COPY,
  renderKitchenCopy,
  renderLinksList,
} from "@/lib/restaurant/telegram/kitchen-copy";
import {
  classifyKitchenReport,
  extractReportFromMessage,
  recordKitchenReport,
  type ExtractedReport,
  type TelegramIncomingMessage,
} from "@/lib/restaurant/telegram/kitchen-reports";
import {
  downloadTelegramImage,
  findPendingPhotoReport,
  type KitchenActor,
  parseKindFollowUp,
  processInvoicePhoto,
  processPriceUpdate,
  routeCaption,
} from "@/lib/restaurant/telegram/kitchen-media";
import { maybeGuideOwnerChat } from "@/lib/restaurant/telegram/owner-chat-guidance";
import { classifyKitchenPhoto } from "@/lib/restaurant/telegram/photo-classify";
import { parsePriceUpdate } from "@/lib/restaurant/telegram/price-update";
import {
  listActiveLinks,
  validateLink,
  type KitchenLink,
} from "@/lib/restaurant/telegram/kitchen-links";
import {
  expirePendingItem,
  getRoutingDefault,
  loadPendingByNonce,
  parseCallbackData,
  resolvePendingItem,
  setRoutingDefault,
} from "@/lib/restaurant/telegram/kitchen-pending";
import {
  announceExpiredOnce,
  buildRoutingKeyboard,
  CHANGE_INDEX,
  createChangeAnchor,
  entriesFor,
  anchorMessageId,
  isAnchor,
  linkLabel,
  linkToActor,
  maybeCleanupPending,
  messageFromPayload,
  PAGE_BASE,
  pageCount,
  parkItem,
  payloadFromMessage,
} from "@/lib/restaurant/telegram/kitchen-routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Photo flow: download + classify + vision extraction can take 20-40 s.
export const maxDuration = 120;

interface TelegramUpdate {
  message?: TelegramIncomingMessage & {
    from?: { id?: number; first_name?: string; last_name?: string };
    chat?: { id?: number; type?: string };
  };
  callback_query?: {
    id?: string;
    from?: { id?: number };
    message?: {
      message_id?: number;
      text?: string;
      chat?: { id?: number; type?: string };
    };
    data?: string;
  };
}

function verifyWebhookSecret(req: NextRequest): boolean {
  return isValidWebhookSecret(
    req.headers.get("x-telegram-bot-api-secret-token"),
    process.env.TELEGRAM_WEBHOOK_SECRET
  );
}

const GENERIC_INVALID_CODE_MESSAGE =
  "This code is invalid or has expired. Generate a new one from Milton.\n\n" +
  "Este código no es válido o expiró. Genera uno nuevo desde Milton.";

const GENERIC_ALREADY_CONNECTED_MESSAGE =
  "This chat or company is already connected to Milton.\n\n" +
  "Este chat o empresa ya está conectado a Milton.";

const GENERIC_USAGE_MESSAGE =
  "Please use the connection link from Milton to pair this chat.\n\n" +
  "Usa el enlace de conexión de Milton para vincular este chat.";

const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again from Milton.\n\n" +
  "Ocurrió un error. Inténtalo de nuevo desde Milton.";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

// Kitchen QR join (private chats only; groups are ignored silently). Cook
// copy is Sofia's Spanish only; on an internal error nothing is sent.
async function handleKitchenJoin(
  message: TelegramMessage,
  chatId: number,
  payload: string
): Promise<void> {
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !fromId) return;
  try {
    const result = await consumeKitchenJoin({
      payload,
      telegramUserId: fromId,
      chatId,
      displayName: buildDisplayName(message.from ?? {}),
    });
    let reply: string;
    switch (result.kind) {
      case "invalid":
        reply = KITCHEN_COPY.QR_INVALID;
        break;
      case "rate_limited":
        reply = KITCHEN_COPY.RATE_LIMITED;
        break;
      case "already_joined":
        reply = renderKitchenCopy(KITCHEN_COPY.ALREADY_JOINED, {
          empresa: result.companyName || "tu restaurante",
          local: result.locationName,
        });
        break;
      case "added":
        reply = renderKitchenCopy(KITCHEN_COPY.JOINED_ADDED, {
          empresa: result.companyName || "tu restaurante",
          local: result.locationName,
        });
        break;
      default:
        reply = renderKitchenCopy(KITCHEN_COPY.JOINED, {
          empresa: result.companyName || "tu restaurante",
          local: result.locationName,
        });
    }
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    console.error(
      "[telegram-webhook] kitchen join failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }
}

type Admin = ReturnType<typeof createAdminClient>;

// One send helper so the confirmation can carry the «Cambiar restaurante»
// button. Without a button it is exactly sendTelegramMessage(chatId, text).
function say(chatId: number, text: string, markup?: InlineKeyboardMarkup) {
  return markup
    ? sendTelegramMessage(chatId, text, { replyMarkup: markup })
    : sendTelegramMessage(chatId, text);
}

// The most recent undecided photo across the account's links (30 min window,
// as for one link). The link that owns it gets the «factura» / «receta» answer.
async function findPendingPhotoAcross(
  admin: Admin,
  links: KitchenLink[],
  chatId: number
) {
  let best: {
    link: KitchenLink;
    pending: NonNullable<Awaited<ReturnType<typeof findPendingPhotoReport>>>;
  } | null = null;
  for (const link of links) {
    const pending = await findPendingPhotoReport(
      admin,
      { id: link.staffId, company_id: link.companyId },
      chatId
    );
    if (!pending) continue;
    if (!best || (pending.dateSec ?? 0) > (best.pending.dateSec ?? 0)) {
      best = { link, pending };
    }
  }
  return best;
}

// The newest recipe draft still waiting for portions (last 2 hours) across
// the account's links.
async function findAwaitingDraftAcross(
  admin: Admin,
  links: KitchenLink[],
  chatId: number
) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const found = await Promise.all(
    links.map(async (link) => {
      const { data } = await admin
        .from("kitchen_recipe_drafts")
        .select("id, created_at")
        .eq("company_id", link.companyId)
        .eq("telegram_chat_id", chatId)
        .eq("staff_id", link.staffId)
        .eq("status", "awaiting_portions")
        .gte("created_at", twoHoursAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data
        ? {
            link,
            createdAt: String(
              (data as { created_at?: string }).created_at ?? ""
            ),
          }
        : null;
    })
  );
  let best: { link: KitchenLink; createdAt: string } | null = null;
  for (const f of found) {
    if (f && (!best || f.createdAt > best.createdAt)) best = f;
  }
  return best;
}

// Several restaurants, no follow-up: the default (set < 30 min ago, link still
// valid) or a question with buttons. Returns the link to process with, or
// null when the item was parked / nothing more is to be done. NOTHING is
// written to any company here.
async function routeAmongLinks(
  fromId: number,
  chatId: number,
  message: TelegramMessage,
  links: KitchenLink[]
): Promise<{ link: KitchenLink; markup?: InlineKeyboardMarkup } | null> {
  const messageId = message.message_id ?? 0;
  const def = await getRoutingDefault(fromId);
  if (def) {
    const valid = await validateLink(fromId, def.staffId);
    if (valid) {
      const markup = await createChangeAnchor({
        telegramUserId: fromId,
        chatId,
        messageId,
        links,
      });
      return { link: valid, markup: markup ?? undefined };
    }
  }

  const parsed = payloadFromMessage(message);
  if (!parsed) return null;
  const parked = await parkItem({
    telegramUserId: fromId,
    chatId,
    telegramMessageId: messageId,
    kind: parsed.kind,
    payload: parsed.payload,
    links,
  });
  if (!parked.ok) {
    console.error("[telegram-webhook] routing item not parked");
    await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_FAILED);
    return null;
  }
  if (!parked.created) return null; // webhook retry: the question is out already
  await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_ASK, {
    replyMarkup: buildRoutingKeyboard(
      parked.nonce,
      "item",
      entriesFor(
        parked.ordered.map((l) => l.staffId),
        parked.ordered
      )
    ),
  });
  return null;
}

// Cook report: private chat, active kitchen_staff only. Unknown, removed
// and group senders are ignored (no row, no reply). Telegram retries
// never double-reply. Simple reports (no recipe intent) reply immediately.
// Recipe extraction and reply happen via after(), including voice transcription.
//
// One restaurant: exactly the old behaviour. Several: follow-ups go to the
// link that owns the pending photo / draft; everything else goes to the
// 30-minute default, or is parked and a question is asked (nothing saved).
async function handleKitchenReport(
  message: TelegramMessage,
  chatId: number
): Promise<void> {
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !fromId) return;
  try {
    const links = await listActiveLinks(fromId);
    if (links.length === 0) {
      // Not a cook. If this chat is an owner-paired briefing chat, say once
      // how to send invoices. Unknown chats stay silent. Nothing is captured.
      await maybeGuideOwnerChat(createAdminClient(), chatId);
      return;
    }
    const multi = links.length > 1;

    const messageId = message.message_id ?? 0;
    const admin = createAdminClient();

    const { data: existingDraft } = await admin
      .from("kitchen_recipe_drafts")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_message_id", messageId)
      .maybeSingle();

    if (existingDraft) {
      return;
    }

    if (multi) {
      maybeCleanupPending();
      await announceExpiredOnce(fromId, chatId);
    }

    const textContent = message.text || message.caption || "";

    const {
      detectRecipeIntent,
      parsePortionsFromFollowUp,
      updateDraftPortions,
    } = await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");

    const intent = detectRecipeIntent(textContent);

    // BEFORE anything is stored as a report: is this chat waiting for the
    // portions of a recipe (asked within the last 2 hours)? A plain text
    // answer then belongs to that draft: it is parsed leniently («1»,
    // «1 hamburguesa», «para 2»…), never stored as a report and never
    // answered with «Recibido…». Photos, voice notes, recipes and report
    // keywords (se acabó, merma…) are NOT answers and go the normal way.
    const isPlainText =
      Boolean(message.text) &&
      !message.photo?.length &&
      !message.voice &&
      !message.document;
    const hasReportWords =
      classifyKitchenReport(textContent) !== "unclassified";

    // «factura» / «receta» answering PHOTO_ASK_KIND: reprocess that staff
    // member's latest undecided photo (last 30 min) exactly once. Nothing
    // pending -> falls through to the normal behaviour below. With several
    // restaurants it is the link whose photo is the most recent: no question.
    const followUpKind = isPlainText ? parseKindFollowUp(textContent) : null;
    if (followUpKind) {
      const found = await findPendingPhotoAcross(admin, links, chatId);
      if (found) {
        const { pending } = found;
        const staff = linkToActor(found.link);
        after(() =>
          processPhotoAsync(
            staff,
            chatId,
            {
              messageId: pending.messageId,
              reportId: pending.reportId,
              caption: pending.caption,
              fileId: pending.fileId,
              mime: pending.mime,
              dateSec: pending.dateSec,
            },
            followUpKind
          )
        );
        return;
      }
    }

    // A price note («el aguacate subió a 1.50 la libra») is never a portions
    // answer.
    const priceParse =
      isPlainText && !hasReportWords ? parsePriceUpdate(textContent) : null;
    if (isPlainText && !intent.isRecipe && !hasReportWords && !priceParse) {
      const awaiting = await findAwaitingDraftAcross(admin, links, chatId);

      if (awaiting) {
        const portions = parsePortionsFromFollowUp(textContent);
        if (portions === null) {
          await sendTelegramMessage(
            chatId,
            KITCHEN_COPY.RECIPE_PORTIONS_UNCLEAR
          );
          return;
        }
        const result = await updateDraftPortions(
          chatId,
          awaiting.link.staffId,
          portions
        );
        // Never leave the cook without an answer: if the draft could not be
        // updated (someone else just did, or it expired), ask again.
        await sendTelegramMessage(
          chatId,
          result.ok
            ? renderKitchenCopy(KITCHEN_COPY.RECIPE_PORTIONS_SET, {
                ...destinationVars(linkToActor(awaiting.link)),
                porciones: `${portions} ${portions === 1 ? "porción" : "porciones"}`,
              })
            : KITCHEN_COPY.RECIPE_PORTIONS_UNCLEAR
        );
        return;
      }
    }

    const report = extractReportFromMessage(message);
    if (!report) return;

    let link = links[0];
    let markup: InlineKeyboardMarkup | undefined;
    if (multi) {
      const routed = await routeAmongLinks(fromId, chatId, message, links);
      if (!routed) return;
      link = routed.link;
      markup = routed.markup;
    }

    await processReport({ link, chatId, message, report, markup });
  } catch (err) {
    console.error("[telegram-webhook] kitchen report failed");
  }
}

// Everything that happens once the restaurant is known: record the report
// (original chat + message ids) and run the invoice / recipe / price / report
// path for that link. Used for a single link, a default, and a replay.
async function processReport(args: {
  link: KitchenLink;
  chatId: number;
  message: TelegramIncomingMessage;
  report: ExtractedReport;
  markup?: InlineKeyboardMarkup;
}): Promise<void> {
  const { link, chatId, message, report, markup } = args;
  const staff = linkToActor(link);
  const admin = createAdminClient();
  const messageId = message.message_id ?? 0;
  const textContent = message.text || message.caption || "";
  const isVoiceWithoutText = Boolean(message.voice) && !textContent;
  const { detectRecipeIntent } =
    await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");
  const intent = detectRecipeIntent(textContent);
  const isPlainText =
    Boolean(message.text) &&
    !message.photo?.length &&
    !message.voice &&
    !message.document;
  const hasReportWords = classifyKitchenReport(textContent) !== "unclassified";
  const priceParse =
    isPlainText && !hasReportWords ? parsePriceUpdate(textContent) : null;

  const inserted = await recordKitchenReport({
    companyId: link.companyId,
    locationId: link.locationId,
    staffId: link.staffId,
    chatId,
    report,
  });
  if (!inserted) {
    return;
  }
  const { data } = await admin
    .from("kitchen_reports")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_message_id", report.telegram_message_id)
    .maybeSingle();
  const reportId = data?.id ?? null;

  // Photos (and image documents): never an immediate acknowledgement. The
  // caption or one vision call decides invoice / recipe / ask / report.
  if (report.media_kind === "photo" && report.telegram_file_id) {
    const fileId = report.telegram_file_id;
    after(() =>
      processPhotoAsync(
        staff,
        chatId,
        {
          messageId,
          reportId,
          caption: report.text,
          fileId,
          mime: report.media_mime,
          dateSec: typeof message.date === "number" ? message.date : null,
        },
        undefined,
        markup
      )
    );
    return;
  }

  if (priceParse?.kind === "price_intent_unclear") {
    await sendTelegramMessage(chatId, KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
    return;
  }
  if (priceParse?.kind === "price_update") {
    const items = priceParse.items;
    after(() =>
      processPriceUpdate({
        admin,
        staff,
        chatId,
        reportId,
        dateSec: typeof message.date === "number" ? message.date : null,
        items,
        origin: "text",
        replyMarkup: markup,
      }).catch(() => {
        console.error("[telegram-webhook] price update failed");
      })
    );
    return;
  }

  if (!intent.isRecipe && !isVoiceWithoutText) {
    await say(
      chatId,
      renderKitchenCopy(KITCHEN_COPY.REPORT_ACK, {
        nombre_local: staff.location_name,
      }),
      markup
    );
    return;
  }

  after(() =>
    processRecipeDraftAsync(
      staff,
      chatId,
      messageId,
      reportId,
      textContent,
      report?.media_kind ?? null,
      report?.telegram_file_id ?? null,
      typeof message.date === "number" ? message.date : null,
      { markup }
    )
  );
}

// `/restaurantes` lists the cook's restaurants; `/restaurante` asks which one
// the next messages go to (30 minutes). One restaurant: just say which.
async function handleRestaurantCommand(
  message: TelegramMessage,
  chatId: number,
  command: "/restaurante" | "/restaurantes"
): Promise<void> {
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !fromId) return;
  try {
    const links = await listActiveLinks(fromId);
    if (links.length === 0) return;
    if (links.length === 1) {
      await sendTelegramMessage(
        chatId,
        renderKitchenCopy(
          KITCHEN_COPY.ONLY_ONE,
          destinationVars(linkToActor(links[0]))
        )
      );
      return;
    }
    if (command === "/restaurantes") {
      await sendTelegramMessage(chatId, renderLinksList(links));
      return;
    }
    maybeCleanupPending();
    const parked = await parkItem({
      telegramUserId: fromId,
      chatId,
      telegramMessageId: anchorMessageId(message.message_id ?? 0),
      kind: "text",
      payload: {},
      links,
      defaultOnly: true,
    });
    if (!parked.ok) {
      await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_FAILED);
      return;
    }
    if (!parked.created) return; // webhook retry
    await sendTelegramMessage(chatId, KITCHEN_COPY.DEFAULT_ASK, {
      replyMarkup: buildRoutingKeyboard(
        parked.nonce,
        "default",
        entriesFor(
          parked.ordered.map((l) => l.staffId),
          parked.ordered
        )
      ),
    });
  } catch {
    console.error("[telegram-webhook] restaurant command failed");
  }
}

// A button tap. Every check must pass or nothing changes: nonce known, same
// Telegram account and chat, not resolved, not expired, index offered, and
// the link still active RIGHT NOW. Failures answer a short toast and log a
// reason code (never ids of data, text or the callback data itself).
async function handleCallbackQuery(
  cq: NonNullable<TelegramUpdate["callback_query"]>
): Promise<void> {
  const queryId = cq.id;
  if (typeof queryId !== "string" || !queryId) return;
  const reject = async (reason: string, toast?: string) => {
    console.info(`[telegram-webhook] callback rejected reason=${reason}`);
    await answerCallbackQuery(queryId, toast ?? KITCHEN_COPY.CALLBACK_INVALID);
  };
  try {
    const fromId = cq.from?.id;
    const chatId = cq.message?.chat?.id;
    const questionId = cq.message?.message_id;
    const editQuestion = async (text: string) => {
      if (typeof chatId === "number" && typeof questionId === "number") {
        await editMessageText(chatId, questionId, text);
      }
    };

    const parsed = parseCallbackData(cq.data ?? "");
    if (!parsed || typeof fromId !== "number") return reject("bad_data");
    maybeCleanupPending();

    const pending = await loadPendingByNonce(parsed.nonce);
    if (!pending) return reject("no_nonce");
    if (pending.telegramUserId !== fromId) return reject("wrong_user");
    if (typeof chatId !== "number" || pending.chatId !== chatId) {
      return reject("wrong_chat");
    }
    if (pending.resolvedAt) return reject("resolved");
    if (Date.now() >= Date.parse(pending.expiresAt)) {
      // Too late: nothing is saved, the payload is cleared, the cook hears it once.
      await expirePendingItem(pending.id);
      if (isAnchor(pending.telegramMessageId)) return reject("expired");
      console.info(`[telegram-webhook] pending expired id=${pending.id}`);
      console.info("[telegram-webhook] callback rejected reason=expired");
      await answerCallbackQuery(queryId, KITCHEN_COPY.ROUTING_EXPIRED_EDIT);
      await editQuestion(KITCHEN_COPY.ROUTING_EXPIRED_EDIT);
      await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_EXPIRED);
      await announceExpiredOnce(fromId, chatId, { send: false });
      return;
    }

    const isDefaultRow = pending.payload.default_only === true;
    if (
      (parsed.kind === "item" && isDefaultRow) ||
      (parsed.kind === "default" && !isDefaultRow)
    ) {
      return reject("bad_data");
    }

    if (parsed.kind === "cancel") {
      await expirePendingItem(pending.id);
      await answerCallbackQuery(queryId);
      await editQuestion(KITCHEN_COPY.ROUTING_CANCELLED);
      return;
    }

    const index = parsed.index ?? 0;

    // Reserved indexes: «Ver más» pages and «Cambiar restaurante».
    if (index >= PAGE_BASE) {
      const page = index - PAGE_BASE;
      const isChange = parsed.kind === "default" && index === CHANGE_INDEX;
      if (!isChange && page >= pageCount(pending.optionStaffIds.length)) {
        return reject("bad_index");
      }
      const links = await listActiveLinks(fromId);
      const entries = entriesFor(pending.optionStaffIds, links);
      if (entries.length === 0) return reject("link_gone");
      const kind = parsed.kind === "item" ? "item" : "default";
      if (isChange) {
        // For FUTURE items only; what is already saved does not move.
        await answerCallbackQuery(queryId);
        await sendTelegramMessage(
          chatId,
          `${KITCHEN_COPY.DEFAULT_ASK} ${KITCHEN_COPY.CHANGE_NOTE}\n${KITCHEN_COPY.CHANGE_HINT}`,
          {
            replyMarkup: buildRoutingKeyboard(
              pending.nonce,
              "default",
              entries
            ),
          }
        );
        return;
      }
      await answerCallbackQuery(queryId);
      if (typeof questionId === "number") {
        await editMessageText(
          chatId,
          questionId,
          cq.message?.text ||
            (isDefaultRow
              ? KITCHEN_COPY.DEFAULT_ASK
              : KITCHEN_COPY.ROUTING_ASK),
          {
            replyMarkup: buildRoutingKeyboard(
              pending.nonce,
              kind,
              entries,
              page
            ),
          }
        );
      }
      return;
    }

    const staffId = pending.optionStaffIds[index];
    if (!staffId) return reject("bad_index");
    const link = await validateLink(fromId, staffId);
    if (!link) return reject("link_gone");

    const resolved = await resolvePendingItem(pending.id, staffId);
    if (!resolved.ok) {
      return reject(
        resolved.reason === "already_resolved"
          ? "resolved"
          : resolved.reason === "expired"
            ? "expired"
            : resolved.reason === "not_found"
              ? "bad_index"
              : "error"
      );
    }
    await setRoutingDefault(fromId, staffId);
    console.info(
      `[telegram-webhook] restaurant chosen pending=${pending.id} staff=${staffId}`
    );
    await answerCallbackQuery(queryId);
    await editQuestion(
      renderKitchenCopy(KITCHEN_COPY.ROUTING_CHOSEN_EDIT, {
        ...destinationVars(linkToActor(link)),
      })
    );

    if (isDefaultRow) {
      await sendTelegramMessage(
        chatId,
        renderKitchenCopy(KITCHEN_COPY.DEFAULT_SET, {
          ...destinationVars(linkToActor(link)),
        })
      );
      return;
    }

    // Replay the parked message exactly as a one-restaurant cook's would run.
    const item = resolved.item;
    const replay = messageFromPayload(
      item.kind,
      item.payload,
      item.telegramMessageId
    );
    const report = extractReportFromMessage(replay);
    if (!report) {
      console.error("[telegram-webhook] parked item could not be replayed");
      await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_FAILED);
      return;
    }
    await processReport({
      link,
      chatId: item.chatId,
      message: replay,
      report,
    });
  } catch {
    console.error("[telegram-webhook] callback failed");
    try {
      await answerCallbackQuery(queryId, KITCHEN_COPY.CALLBACK_INVALID);
    } catch {
      // nothing more to do
    }
  }
}

async function processRecipeDraftAsync(
  staff: KitchenActor,
  chatId: number,
  messageId: number,
  reportId: string | null,
  textContent: string,
  mediaKind: "photo" | "voice" | null,
  telegramFileId: string | null,
  dateSec: number | null = null,
  opts: { forceRecipe?: boolean; markup?: InlineKeyboardMarkup } = {}
) {
  try {
    const admin = createAdminClient();

    const { data: existingDraft } = await admin
      .from("kitchen_recipe_drafts")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_message_id", messageId)
      .maybeSingle();

    if (existingDraft) {
      return;
    }

    let finalTextContent = textContent;

    if (mediaKind === "voice" && telegramFileId && !finalTextContent) {
      const { openTelegramFile } =
        await import("@/lib/restaurant/telegram/files");
      const stream = await openTelegramFile(telegramFileId);
      if (stream.ok && process.env.OPENAI_API_KEY) {
        const chunks: Uint8Array[] = [];
        const reader = stream.body.getReader();
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (value) chunks.push(value);
          done = readerDone;
        }
        const buffer = Buffer.concat(chunks);
        const uint8Array = new Uint8Array(buffer);
        const blob = new Blob([uint8Array], { type: "audio/ogg" });
        const file = new File([blob], "voice.ogg", { type: "audio/ogg" });

        try {
          const { default: OpenAI } = await import("openai");
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 20000,
            maxRetries: 0,
          });
          const transcription = await client.audio.transcriptions.create({
            file,
            model: "whisper-1",
            language: "es",
          });
          finalTextContent = transcription.text;
        } catch (err) {
          console.error("[telegram-webhook] voice processing failed");
        }
      }
    }

    const { detectRecipeIntent, extractAndCreateRecipeDraft } =
      await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");

    if (!opts.forceRecipe) {
      // Order: report words -> price update -> recipe -> plain acknowledgement.
      const ack = () =>
        say(
          chatId,
          renderKitchenCopy(KITCHEN_COPY.REPORT_ACK, {
            nombre_local: staff.location_name,
          }),
          opts.markup
        );
      if (classifyKitchenReport(finalTextContent) !== "unclassified") {
        await ack();
        return;
      }
      const price = parsePriceUpdate(finalTextContent);
      if (price?.kind === "price_intent_unclear") {
        await sendTelegramMessage(chatId, KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
        return;
      }
      if (price?.kind === "price_update") {
        await processPriceUpdate({
          admin,
          staff,
          chatId,
          reportId,
          dateSec,
          items: price.items,
          origin: mediaKind === "voice" ? "voice" : "text",
          replyMarkup: opts.markup,
        });
        return;
      }
      if (!detectRecipeIntent(finalTextContent).isRecipe) {
        await ack();
        return;
      }
    }

    // Every ingredient and every cost entry, in pages: a plain select stops
    // at 1,000 rows and would silently leave ingredients without a price.
    // Only ACTIVE ingredients: a merged-away (archived) one is never matched;
    // its old name reaches the survivor through the alias.
    const ingredients = (await loadCompanyIngredients(admin, staff.company_id))
      .filter(isActiveIngredient)
      .map((row) => ({
        id: row.id,
        name: row.name,
        default_unit: row.default_unit ?? "unit",
      }));
    const ingredientIds = ingredients.map((i) => i.id);

    type CostEntryRow = {
      ingredient_id: string;
      normalized_unit_cost: number;
      normalized_unit: string;
      cost_date: string;
      currency: string;
      created_at: string;
      id: string;
      company_id: string;
      supplier_id: string | null;
      source_type: "manual" | "invoice_line" | "import" | "api";
      source_id: string | null;
      quantity: number;
      unit: string;
      total_cost: number;
      unit_cost: number;
    };
    let costEntries: CostEntryRow[] = [];

    if (ingredientIds.length > 0) {
      const costEntriesRes = await fetchAllRows<CostEntryRow>(() =>
        admin
          .from("ingredient_cost_entries")
          .select(
            "id, company_id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit_cost, normalized_unit, currency, created_at"
          )
          .eq("company_id", staff.company_id)
      );
      costEntries = costEntriesRes.error ? [] : costEntriesRes.rows;
    }

    // Names this company already taught Milton (ingredient_aliases).
    const aliasKeyToId = new Map<string, string>();
    try {
      const aliasRepo = createSupabaseCostWorkbookRepo(admin);
      for (const row of await aliasRepo.listIngredientAliases(
        staff.company_id
      )) {
        aliasKeyToId.set(row.alias_key, row.ingredient_id);
      }
    } catch {
      // no alias table yet: exact and synonym matching still work
    }

    const costMap = new Map<string, typeof costEntries>();
    for (const entry of costEntries) {
      if (!costMap.has(entry.ingredient_id)) {
        costMap.set(entry.ingredient_id, []);
      }
      costMap.get(entry.ingredient_id)!.push(entry);
    }

    const result = await extractAndCreateRecipeDraft(
      {
        companyId: staff.company_id,
        locationId: staff.location_id,
        staffId: staff.id,
        kitchenReportId: reportId,
        chatId,
        messageId,
        mediaKind,
        telegramFileId,
        text: finalTextContent || null,
        currency: resolveWriteCurrency(
          costEntries[0]?.currency,
          await resolveCompanyCurrency(admin, staff.company_id)
        ),
      },
      ingredients,
      costMap,
      aliasKeyToId
    );

    if (result.ok) {
      const { data: draft } = await admin
        .from("kitchen_recipe_drafts")
        .select("dish_name, status")
        .eq("id", result.draftId)
        .maybeSingle();

      if (draft?.status === "awaiting_portions") {
        await sendTelegramMessage(chatId, KITCHEN_COPY.RECIPE_ASK_PORTIONS);
      } else {
        await say(
          chatId,
          renderKitchenCopy(KITCHEN_COPY.RECIPE_RECEIVED, {
            ...destinationVars(staff),
            plato: draft?.dish_name ?? "tu receta",
          }),
          opts.markup
        );
      }
    } else if (result.error !== "duplicate") {
      // Never stay silent when the recipe could not be saved.
      console.error("[telegram-webhook] recipe draft not saved");
      await sendTelegramMessage(chatId, KITCHEN_COPY.RECIPE_SAVE_FAILED);
    }
  } catch (err) {
    console.error("[telegram-webhook] recipe draft async failed");
  }
}

interface PhotoJob {
  messageId: number;
  reportId: string | null;
  caption: string | null;
  fileId: string;
  mime: string | null;
  dateSec: number | null;
}

// Photo / image document: caption shortcut, else ONE cheap vision call; when
// unsure, ask «¿factura o receta?». Everything runs inside after().
async function processPhotoAsync(
  staff: KitchenActor,
  chatId: number,
  job: PhotoJob,
  forced?: "invoice" | "recipe",
  markup?: InlineKeyboardMarkup
) {
  try {
    const admin = createAdminClient();
    let dataUrl: string | null = null;
    let kind: "invoice" | "recipe" | "report" | null =
      forced ?? routeCaption(job.caption);

    if (!kind && job.caption) {
      const { detectRecipeIntent } =
        await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");
      if (detectRecipeIntent(job.caption).isRecipe) kind = "recipe";
    }

    if (!kind) {
      dataUrl = await downloadTelegramImage(job.fileId, job.mime);
      const verdict = dataUrl ? await classifyKitchenPhoto(dataUrl) : null;
      if (
        verdict?.ok &&
        verdict.confidence !== "low" &&
        (verdict.kind === "invoice" || verdict.kind === "recipe")
      ) {
        kind = verdict.kind;
      } else {
        await sendTelegramMessage(chatId, KITCHEN_COPY.PHOTO_ASK_KIND);
        return;
      }
    }

    if (kind === "report") {
      await say(
        chatId,
        renderKitchenCopy(KITCHEN_COPY.REPORT_ACK, {
          nombre_local: staff.location_name,
        }),
        markup
      );
      return;
    }

    if (kind === "invoice") {
      await processInvoicePhoto({
        admin,
        staff,
        chatId,
        messageId: job.messageId,
        reportId: job.reportId,
        fileId: job.fileId,
        mime: job.mime,
        dateSec: job.dateSec,
        dataUrl,
        replyMarkup: markup,
      });
      return;
    }

    await processRecipeDraftAsync(
      staff,
      chatId,
      job.messageId,
      job.reportId,
      job.caption ?? "",
      "photo",
      job.fileId,
      job.dateSec,
      { forceRecipe: true, markup }
    );
  } catch {
    console.error("[telegram-webhook] photo processing failed");
    try {
      await sendTelegramMessage(chatId, KITCHEN_COPY.PHOTO_PROCESS_FAILED);
    } catch {
      // nothing more to do
    }
  }
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // malformed body — nothing to do
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || !chatId) {
    return NextResponse.json({ ok: true }); // no message — ignore
  }

  const trimmed = (message.text ?? "").trim();
  const command = trimmed.startsWith("/")
    ? trimmed.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "")
    : "";
  if (command === "/restaurante" || command === "/restaurantes") {
    await handleRestaurantCommand(message, chatId, command);
    return NextResponse.json({ ok: true });
  }
  if (!trimmed.startsWith("/start")) {
    // Not a pairing/join command. Any other command is ignored; a
    // non-command message may be a cook report (text, voice or photo).
    if (!trimmed.startsWith("/")) {
      await handleKitchenReport(message, chatId);
    }
    return NextResponse.json({ ok: true });
  }

  const code = trimmed.slice("/start".length).trim();
  if (!code) {
    await sendTelegramMessage(chatId, GENERIC_USAGE_MESSAGE);
    return NextResponse.json({ ok: true });
  }

  // Kitchen QR payloads (kq1_...) never collide with 12-char pairing codes.
  if (isKitchenPayload(code)) {
    await handleKitchenJoin(message, chatId, code);
    return NextResponse.json({ ok: true });
  }

  let result: Awaited<ReturnType<typeof consumePairingCode>>;
  try {
    result = await consumePairingCode(code, chatId);
  } catch (err) {
    console.error(
      "[telegram-webhook] pairing consumption failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    await sendTelegramMessage(chatId, GENERIC_ERROR_MESSAGE);
    return NextResponse.json({ ok: true });
  }

  if (!result.ok) {
    const message =
      result.reason === "invalid_or_expired"
        ? GENERIC_INVALID_CODE_MESSAGE
        : result.reason === "chat_already_connected"
          ? KITCHEN_COPY.BRIEFING_CHAT_ALREADY_CONNECTED
          : GENERIC_ALREADY_CONNECTED_MESSAGE;
    await sendTelegramMessage(chatId, message);
    return NextResponse.json({ ok: true });
  }

  // Success — look up the NEWLY CONNECTED company's own name/
  // preferred_language solely to phrase ITS OWN confirmation message.
  // This never touches, and never reveals, any other company's data.
  let confirmation = "✅ Connected! You'll receive Milton briefings here.";
  try {
    const admin = createAdminClient();
    const { data: company } = await admin
      .from("companies")
      .select("name, preferred_language")
      .eq("id", result.companyId)
      .maybeSingle();
    const lang = resolvePreferredLanguage(company?.preferred_language);
    const name = company?.name ?? "";
    confirmation = t(
      lang,
      `✅ Connected${name ? ` to ${name}` : ""}! You'll receive Milton briefings here.`,
      `✅ ¡Conectado${name ? ` a ${name}` : ""}! Recibirás los briefings de Milton aquí.`
    );
  } catch (err) {
    console.error(
      "[telegram-webhook] confirmation lookup failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    // Falls back to the generic English confirmation already set above.
  }

  await sendTelegramMessage(chatId, confirmation);
  return NextResponse.json({ ok: true });
}
