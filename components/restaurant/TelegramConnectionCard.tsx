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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, MessageCircle, RefreshCw, CheckCircle2 } from "lucide-react";

interface ConnectionStatus {
  connected: boolean;
  connected_at: string | null;
  preferred_language: "en" | "es";
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
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const [sendLoading, setSendLoading] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null);

  async function loadStatus() {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/restaurant/telegram/connection");
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setStatusError(
          (json.error as string) || "Could not load Telegram status."
        );
        return;
      }
      setStatus(json as unknown as ConnectionStatus);
      if (json.connected) {
        // A fresh connection makes any stale pairing code moot.
        setPairing(null);
      }
    } catch {
      setStatusError("Could not load Telegram status.");
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleConnect() {
    setPairingLoading(true);
    setPairingError(null);
    try {
      const res = await fetch("/api/restaurant/telegram/pairing-code", {
        method: "POST",
      });
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setPairingError(
          (json.error as string) || "Could not start Telegram pairing."
        );
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
      setPairingError("Could not start Telegram pairing. Please try again.");
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
          message:
            (json.error as string) ||
            "Could not send the test briefing. Please try again.",
        });
        return;
      }
      setSendFeedback({
        kind: "success",
        message: "Sent! Check your Telegram chat.",
      });
    } catch {
      setSendFeedback({
        kind: "error",
        message: "Could not send the test briefing. Please try again.",
      });
    } finally {
      setSendLoading(false);
    }
  }

  const languageLabel =
    status?.preferred_language === "es" ? "Spanish" : "English";

  const botHandle = pairing ? extractBotUsername(pairing.deepLink) : null;
  const botMention = botHandle ? `@${botHandle}` : "our Milton bot";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Telegram Briefing
        </CardTitle>
        <CardDescription>
          Get your Milton executive briefing delivered to Telegram
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : statusError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load Telegram status</AlertTitle>
            <AlertDescription>
              {statusError}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-fit gap-1.5"
                onClick={loadStatus}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : status?.connected ? (
          <>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Briefings will be sent in {languageLabel}, matching your Milton
              language setting.
            </p>
            <Button
              onClick={handleSendTest}
              disabled={sendLoading}
              className="w-full sm:w-auto gap-2"
            >
              <Send className="h-4 w-4" />
              {sendLoading ? "Sending…" : "Send test briefing"}
            </Button>
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
              <Badge variant="outline">Not connected</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Connect a Telegram chat to receive your daily Milton briefing
              there too.
            </p>
            <Button
              onClick={handleConnect}
              disabled={pairingLoading}
              className="w-full sm:w-auto gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              {pairingLoading ? "Starting…" : "Connect Telegram"}
            </Button>

            {pairingError && (
              <Alert variant="destructive">
                <AlertDescription>{pairingError}</AlertDescription>
              </Alert>
            )}

            {pairing && (
              <Alert className="space-y-2">
                <AlertTitle>Finish connecting in Telegram</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {pairing.deepLink
                      ? `We opened Telegram for you. If it didn't open, send this code to ${botMention} yourself:`
                      : `Open Telegram, message ${botMention}, and send this code:`}
                  </p>
                  <code className="block w-fit rounded bg-muted px-2 py-1 text-sm font-mono">
                    /start {pairing.code}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    This code expires in about 15 minutes.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={loadStatus}
                    disabled={statusLoading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    I&apos;ve connected — refresh status
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
