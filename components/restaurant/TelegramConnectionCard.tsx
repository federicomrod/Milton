"use client";
// components/restaurant/TelegramConnectionCard.tsx
//
// Telegram Connection UI v1 — the smallest UI needed to make the
// already-built Telegram Daily Briefing backend usable: pair a Telegram
// chat, then send a first test briefing. No disconnect/reconnect, no
// scheduling, no chat/photo/voice UI — those are explicitly deferred.
//
// Talks only to the existing authenticated routes:
//   GET  /api/restaurant/telegram/connection     (status — new, read-only,
//        reuses restaurant_telegram_connections + isUsableConnection())
//   POST /api/restaurant/telegram/pairing-code   (existing)
//   POST /api/restaurant/telegram/send-briefing  (existing)
//
// Pairing UX: requesting a code always shows both the deep link AND the
// raw code + manual instructions side by side — there is no reliable way
// for client JS to detect whether a t.me deep link actually opened the
// Telegram app, so the "fallback" is simply always visible rather than
// conditionally revealed.

import { useEffect, useState } from "react";

export const PAIRING_POLL_INTERVAL_MS = 3000;
export const PAIRING_POLL_MAX_MS = 3 * 60 * 1000;
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/components/restaurant/shell/shell-chrome-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, MessageCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { useT } from "@/lib/i18n/client";
import type { PreferredLanguage } from "@/lib/restaurant/language";

interface ConnectionStatus {
  connected: boolean;
  connected_at: string | null;
  company_name?: string | null;
  preferred_language: PreferredLanguage;
}

interface PairingState {
  code: string;
  deepLink: string | null;
  expiresAt: string;
}

type SendFeedback = { kind: "success" | "error"; message: string };

/**
 * Pulls the bot's @username out of a `https://t.me/<username>?start=...`
 * deep link, so the fallback instructions never hardcode a bot name that
 * could drift from what the server actually configured
 * (TELEGRAM_BOT_USERNAME). Pure — no I/O, directly unit-testable.
 */
export function extractBotUsername(deepLink: string | null): string | null {
  if (!deepLink) return null;
  try {
    const path = new URL(deepLink).pathname.replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

async function parseJsonSafely(
  res: Response
): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export function TelegramConnectionCard() {
  const canEdit = useCan("company.edit");
  const { d, fmt } = useT();
  const dt = d.settings.telegram;
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const [sendLoading, setSendLoading] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null);

  async function loadStatus(silent = false) {
    if (!silent) {
      setStatusLoading(true);
      setStatusError(null);
    }
    try {
      const res = await fetch("/api/restaurant/telegram/connection");
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        if (!silent) {
          setStatusError(userErrorMessage(json, dt.loadFailed));
        }
        return;
      }
      setStatus(json as unknown as ConnectionStatus);
      if (json.connected) {
        // A fresh connection makes any stale pairing code moot.
        setPairing(null);
      }
    } catch {
      if (!silent) setStatusError(dt.loadFailed);
    } finally {
      if (!silent) setStatusLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  // While the pairing box is shown, check the status every 3 s for up to 3
  // minutes so «Conectado» appears without pressing anything. Stops when
  // connected (the box disappears), on expiry and on unmount.
  const pairingCode = pairing?.code ?? null;
  useEffect(() => {
    if (!pairingCode) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt >= PAIRING_POLL_MAX_MS) {
        clearInterval(id);
        return;
      }
      void loadStatus(true);
    }, PAIRING_POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingCode]);

  async function handleConnect() {
    setPairingLoading(true);
    setPairingError(null);
    try {
      const res = await fetch("/api/restaurant/telegram/pairing-code", {
        method: "POST",
      });
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setPairingError(userErrorMessage(json, dt.pairingFailed));
        // The company may already be connected on the server (e.g. a
        // second tab completed pairing first) — re-check rather than
        // leaving a stale "Not connected" view up.
        loadStatus();
        return;
      }
      const issued: PairingState = {
        code: json.code as string,
        deepLink: (json.deep_link as string | null) ?? null,
        expiresAt: json.expires_at as string,
      };
      setPairing(issued);
      if (issued.deepLink) {
        window.open(issued.deepLink, "_blank", "noopener,noreferrer");
      }
    } catch {
      setPairingError(dt.pairingFailedRetry);
    } finally {
      setPairingLoading(false);
    }
  }

  async function handleSendTest() {
    setSendLoading(true);
    setSendFeedback(null);
    try {
      const res = await fetch("/api/restaurant/telegram/send-briefing", {
        method: "POST",
      });
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setSendFeedback({
          kind: "error",
          message: userErrorMessage(json, dt.sendFailed),
        });
        return;
      }
      setSendFeedback({
        kind: "success",
        message: dt.sent,
      });
    } catch {
      setSendFeedback({
        kind: "error",
        message: dt.sendFailed,
      });
    } finally {
      setSendLoading(false);
    }
  }

  const languageLabel =
    status?.preferred_language === "de"
      ? dt.languageNameDe
      : status?.preferred_language === "es"
        ? dt.languageNameEs
        : dt.languageNameEn;

  const botHandle = pairing ? extractBotUsername(pairing.deepLink) : null;
  const botMention = botHandle ? `@${botHandle}` : dt.miltonBot;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          {dt.title}
        </CardTitle>
        <CardDescription>{dt.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <p className="text-sm text-muted-foreground">{dt.loading}</p>
        ) : statusError ? (
          <Alert variant="destructive">
            <AlertTitle>{dt.loadFailedTitle}</AlertTitle>
            <AlertDescription>
              {statusError}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-fit gap-1.5"
                onClick={() => loadStatus()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {dt.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : status?.connected ? (
          <>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0">
                <CheckCircle2 className="h-3 w-3" />
                {status.company_name
                  ? fmt(dt.connectedTo, { name: status.company_name })
                  : dt.connected}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {fmt(dt.briefingsLanguage, { language: languageLabel })}
            </p>
            <p className="text-sm text-[#6b7280]">{dt.kitchenHint}</p>
            <Button
              onClick={handleSendTest}
              disabled={sendLoading || !canEdit}
              className="w-full sm:w-auto gap-2"
            >
              <Send className="h-4 w-4" />
              {sendLoading ? dt.sending : dt.sendTest}
            </Button>
            {!canEdit && (
              <p className="text-[13px] text-[#6b7280]">
                {d.settings.noEditCompany}
              </p>
            )}
            {sendFeedback && (
              <Alert
                variant={
                  sendFeedback.kind === "error" ? "destructive" : "default"
                }
                className={
                  sendFeedback.kind === "success"
                    ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20"
                    : undefined
                }
              >
                <AlertDescription
                  className={
                    sendFeedback.kind === "success"
                      ? "text-green-800 dark:text-green-300"
                      : undefined
                  }
                >
                  {sendFeedback.message}
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{dt.notConnected}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{dt.connectIntro}</p>
            <Button
              onClick={handleConnect}
              disabled={pairingLoading || !canEdit}
              className="w-full sm:w-auto gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              {pairingLoading ? dt.starting : dt.connect}
            </Button>

            {!canEdit && (
              <p className="text-[13px] text-[#6b7280]">
                {d.settings.noEditCompany}
              </p>
            )}
            {pairingError && (
              <Alert variant="destructive">
                <AlertDescription>{pairingError}</AlertDescription>
              </Alert>
            )}

            {pairing && (
              <Alert className="min-w-0 max-w-full space-y-2 overflow-hidden">
                <AlertTitle className="line-clamp-none whitespace-normal">
                  {dt.finishTitle}
                </AlertTitle>
                <AlertDescription className="min-w-0 grid-cols-[minmax(0,1fr)] space-y-2">
                  <p className="break-words">
                    {pairing.deepLink ? dt.openedTelegram : dt.openTelegram}
                    <span className="break-all max-w-full">{botMention}</span>
                    {pairing.deepLink ? ":" : dt.andSendCode}
                  </p>
                  <code className="block w-fit max-w-full break-all rounded bg-muted px-2 py-1 text-sm font-mono">
                    /start {pairing.code}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    {dt.codeExpires}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto w-full max-w-full gap-1.5 whitespace-normal text-left sm:w-auto"
                    onClick={() => loadStatus()}
                    disabled={statusLoading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {dt.refresh}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
