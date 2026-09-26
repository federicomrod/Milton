"use client";
// components/restaurant/EmailBriefingCard.tsx
//
// Email Briefing Extension v1 — the settings UI for company-level email
// delivery preferences. Talks only to the existing authenticated routes:
//   GET  /api/restaurant/briefing/email/preferences
//   POST /api/restaurant/briefing/email/preferences
//   POST /api/restaurant/briefing/email/send-test
//
// No scheduler UI here — cadence/weekday/timezone are captured now so the
// scheduler (a separate, not-yet-activated proposal) has what it needs
// once it ships; nothing in this component assumes it is running.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Send } from "lucide-react";

type Cadence = "off" | "daily" | "weekly";

interface Preferences {
  cadence: Cadence;
  recipient: string | null;
  weekday: number;
  timezone: string;
}

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const CADENCE_LABELS: Record<Cadence, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedTimezones: string[] | null = null;
function getTimezones(): string[] {
  if (cachedTimezones) return cachedTimezones;
  try {
    cachedTimezones = Intl.supportedValuesOf("timeZone");
  } catch {
    cachedTimezones = ["UTC"];
  }
  return cachedTimezones;
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

export function EmailBriefingCard() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cadence, setCadence] = useState<Cadence>("off");
  const [recipient, setRecipient] = useState("");
  const [weekday, setWeekday] = useState(1);
  // "" means "not yet explicitly chosen" — the Select then shows its
  // placeholder rather than a value. Never defaults to "UTC" implicitly;
  // see handleCadenceChange() below for why.
  const [timezone, setTimezone] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const [sendingTest, setSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/restaurant/briefing/email/preferences");
        const json = await parseJsonSafely(res);
        if (!res.ok) {
          setLoadError(
            (json.error as string) ||
              "Could not load briefing delivery settings."
          );
          return;
        }
        const loaded = json as unknown as Preferences;
        setPrefs(loaded);
        setCadence(loaded.cadence);
        setRecipient(loaded.recipient ?? "");
        setWeekday(loaded.weekday);
        setTimezone(loaded.timezone);
      } catch {
        setLoadError("Could not load briefing delivery settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const recipientValid = EMAIL_PATTERN.test(recipient.trim());
  const timezoneChosen = timezone.trim().length > 0;
  const canSave = cadence === "off" || (recipientValid && timezoneChosen);

  // Adjustment: never allow enabling Daily/Weekly with an accidentally
  // implicit timezone. The moment cadence flips ON from "off", force an
  // explicit re-pick rather than silently carrying over whatever was
  // loaded (which could be the server's own "not yet configured" UTC
  // default) — mirrors the server-side rule in
  // resolveTimezoneForCadence(). Toggling among daily/weekly, or loading
  // an already-configured company, never clears an existing valid choice.
  function handleCadenceChange(next: Cadence) {
    if (cadence === "off" && next !== "off") {
      setTimezone("");
    }
    setCadence(next);
  }

  async function handleSave() {
    setSaving(true);
    setSaveFeedback(null);
    try {
      const res = await fetch("/api/restaurant/briefing/email/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence,
          recipient: recipient.trim() || null,
          weekday,
          timezone,
        }),
      });
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setSaveFeedback({
          kind: "error",
          message: (json.error as string) || "Could not save settings.",
        });
        return;
      }
      setPrefs({
        cadence,
        recipient: recipient.trim() || null,
        weekday,
        timezone,
      });
      setSaveFeedback({ kind: "success", message: "Saved." });
    } catch {
      setSaveFeedback({ kind: "error", message: "Could not save settings." });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    setTestFeedback(null);
    try {
      const res = await fetch("/api/restaurant/briefing/email/send-test", {
        method: "POST",
      });
      const json = await parseJsonSafely(res);
      if (!res.ok) {
        setTestFeedback({
          kind: "error",
          message:
            (json.error as string) ||
            "Could not send the test email. Please try again.",
        });
        return;
      }
      setTestFeedback({
        kind: "success",
        message: `Sent! Check ${prefs?.recipient ?? "your inbox"}.`,
      });
    } catch {
      setTestFeedback({
        kind: "error",
        message: "Could not send the test email. Please try again.",
      });
    } finally {
      setSendingTest(false);
    }
  }

  // Deliberately based on the last SAVED preferences, not the live form
  // state — a test send goes to whatever is actually stored server-side,
  // so the button should only appear available when that's true.
  const canSendTest = !!prefs?.recipient && prefs.cadence !== "off";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Briefing Delivery
        </CardTitle>
        <CardDescription>
          Get your Milton executive briefing delivered by email
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="briefing-cadence">Frequency</Label>
              <Select
                value={cadence}
                onValueChange={(v) => handleCadenceChange(v as Cadence)}
              >
                <SelectTrigger id="briefing-cadence" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CADENCE_LABELS) as Cadence[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CADENCE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {cadence !== "off" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="briefing-recipient">Recipient email</Label>
                  <Input
                    id="briefing-recipient"
                    type="email"
                    placeholder="owner@yourrestaurant.com"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    maxLength={254}
                  />
                  {recipient.trim().length > 0 && !recipientValid && (
                    <p className="text-xs text-destructive">
                      Enter a valid email address.
                    </p>
                  )}
                </div>

                {cadence === "weekly" && (
                  <div className="space-y-2">
                    <Label htmlFor="briefing-weekday">Day of week</Label>
                    <Select
                      value={String(weekday)}
                      onValueChange={(v) => setWeekday(Number(v))}
                    >
                      <SelectTrigger
                        id="briefing-weekday"
                        className="h-11 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_LABELS.map((label, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="briefing-timezone">Delivery timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger
                      id="briefing-timezone"
                      className="h-11 w-full"
                    >
                      <SelectValue placeholder="Select a timezone" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {getTimezones().map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!timezoneChosen && (
                    <p className="text-xs text-destructive">
                      Select the timezone this briefing should be delivered in.
                    </p>
                  )}
                </div>
              </>
            )}

            <Button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="w-full sm:w-auto"
            >
              {saving ? "Saving…" : "Save"}
            </Button>

            {saveFeedback && (
              <Alert
                variant={
                  saveFeedback.kind === "error" ? "destructive" : "default"
                }
                className={
                  saveFeedback.kind === "success"
                    ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20"
                    : undefined
                }
              >
                <AlertDescription
                  className={
                    saveFeedback.kind === "success"
                      ? "text-green-800 dark:text-green-300"
                      : undefined
                  }
                >
                  {saveFeedback.message}
                </AlertDescription>
              </Alert>
            )}

            {canSendTest && (
              <div className="pt-2 border-t border-border space-y-3">
                <Button
                  variant="outline"
                  onClick={handleSendTest}
                  disabled={sendingTest}
                  className="w-full sm:w-auto gap-2"
                >
                  <Send className="h-4 w-4" />
                  {sendingTest ? "Sending…" : "Send test email"}
                </Button>
                {testFeedback && (
                  <Alert
                    variant={
                      testFeedback.kind === "error" ? "destructive" : "default"
                    }
                    className={
                      testFeedback.kind === "success"
                        ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20"
                        : undefined
                    }
                  >
                    <AlertDescription
                      className={
                        testFeedback.kind === "success"
                          ? "text-green-800 dark:text-green-300"
                          : undefined
                      }
                    >
                      {testFeedback.message}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
