// lib/restaurant/telegram/files.ts
//
// Telegram file proxy for kitchen report media (R1 #49): runs getFile for a
// stored file_id and streams the bytes back so managers can view photos and
// play voice notes without anything being stored by Milton. Server-only.
//
// This is the SECOND (and last besides send.ts) file that reads the bot
// token. It follows send.ts's rules exactly: the token is embedded in the
// Bot API URLs, so this file NEVER logs the token, a URL, or a raw error
// message (only static text or err.name), never returns the token or a URL
// to a caller, and every failure resolves to a generic result instead of
// throwing. Telegram limits bot downloads to 20 MB, fine for voice/photos.

const TELEGRAM_API_BASE = "https://api.telegram.org";

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export type TelegramFileStream =
  | {
      ok: true;
      body: ReadableStream<Uint8Array>;
      contentLength: string | null;
    }
  | { ok: false; error: string };

/** Resolves a file_id to a stream of its bytes. Never throws. */
export async function openTelegramFile(
  fileId: string
): Promise<TelegramFileStream> {
  const token = getBotToken();
  if (!token) {
    console.error("[telegram-files] config error: bot token not set");
    return { ok: false, error: "Telegram is not configured." };
  }

  try {
    const metaRes = await fetch(
      `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    if (!metaRes.ok) {
      console.error("[telegram-files] getFile failed: HTTP", metaRes.status);
      return { ok: false, error: "Could not load the file." };
    }
    const meta = (await metaRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = meta.ok ? meta.result?.file_path : undefined;
    if (!filePath) {
      console.error("[telegram-files] getFile returned no file path");
      return { ok: false, error: "Could not load the file." };
    }

    const fileRes = await fetch(
      `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`
    );
    if (!fileRes.ok || !fileRes.body) {
      console.error("[telegram-files] download failed: HTTP", fileRes.status);
      return { ok: false, error: "Could not load the file." };
    }
    return {
      ok: true,
      body: fileRes.body,
      contentLength: fileRes.headers.get("content-length"),
    };
  } catch (err) {
    console.error(
      "[telegram-files] request failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Could not reach Telegram." };
  }
}
