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
import { Notice } from "@/components/restaurant/config/account/Notice";
import { Mail, Send } from "lucide-react";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { useT } from "@/lib/i18n/client";

type Cadence = "off" | "daily" | "weekly";

interface Preferences {
  cadence: Cadence;
  recipient: string | null;
  weekday: number;
  timezone: string;
  default_timezone?: string | null;
}

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

export function EmailBriefingCard({
  embedded = false,
  onSaved,
  onCancel,
  onDirty,
}: {
  /** Inside Configuración › Mi cuenta: no Card chrome, Cancelar button. */
  embedded?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
  onDirty?: (dirty: boolean) => void;
} = {}) {
  const { d, fmt } = useT();
  const c = d.comms.emailCard;
  const CADENCE_LABELS: Record<Cadence, string> = {
    off: c.cadenceOff,
    daily: c.cadenceDaily,
    weekly: c.cadenceWeekly,
  };
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
  // The restaurant's timezone, used when delivery is switched on.
  const [defaultTimezone, setDefaultTimezone] = useState("");

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
          setLoadError(userErrorMessage(json, c.loadFailed));
          return;
        }
        const loaded = json as unknown as Preferences;
        setPrefs(loaded);
        setCadence(loaded.cadence);
        setRecipient(loaded.recipient ?? "");
        setWeekday(loaded.weekday);
        setTimezone(loaded.timezone);
        setDefaultTimezone(loaded.default_timezone ?? "");
      } catch {
        setLoadError(c.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!onDirty || !prefs) return;
    onDirty(
      cadence !== prefs.cadence ||
        recipient.trim() !== (prefs.recipient ?? "") ||
        weekday !== prefs.weekday ||
        timezone !== prefs.timezone
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadence, recipient, weekday, timezone, prefs]);

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
      setTimezone(defaultTimezone);
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
          message: userErrorMessage(json, c.saveFailed),
        });
        return;
      }
      setPrefs({
        cadence,
        recipient: recipient.trim() || null,
        weekday,
        timezone,
      });
      setSaveFeedback({ kind: "success", message: c.saved });
      onDirty?.(false);
      onSaved?.();
    } catch {
      setSaveFeedback({
        kind: "error",
        message: c.saveFailed,
      });
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
          message: userErrorMessage(json, c.testFailed),
        });
        return;
      }
      setTestFeedback({
        kind: "success",
        message: prefs?.recipient
          ? fmt(c.sentTo, { recipient: prefs.recipient })
          : c.sentToInbox,
      });
    } catch {
      setTestFeedback({
        kind: "error",
        message: c.testFailed,
      });
    } finally {
      setSendingTest(false);
    }
  }

  // Deliberately based on the last SAVED preferences, not the live form
  // state — a test send goes to whatever is actually stored server-side,
  // so the button should only appear available when that's true.
  const canSendTest = !!prefs?.recipient && prefs.cadence !== "off";

  const Wrapper = embedded ? EmbeddedBody : CardBody;
  return (
    <Wrapper
      icon={<Mail className="h-5 w-5" />}
      title={c.title}
      description={c.description}
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">{c.loading}</p>
      ) : loadError ? (
        <Notice kind="error">{loadError}</Notice>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="briefing-cadence">{c.cadence}</Label>
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
                <Label htmlFor="briefing-recipient">{c.recipient}</Label>
                <Input
                  id="briefing-recipient"
                  type="email"
                  placeholder="owner@yourrestaurant.com"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  maxLength={254}
                />
                {recipient.trim().length > 0 && !recipientValid && (
                  <p className="text-xs text-[#0F172A]">⚑ {c.invalidEmail}</p>
                )}
              </div>

              {cadence === "weekly" && (
                <div className="space-y-2">
                  <Label htmlFor="briefing-weekday">{c.weekday}</Label>
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
                      {c.weekdays.map((label, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="briefing-timezone">{c.timezone}</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="briefing-timezone" className="h-11 w-full">
                    <SelectValue placeholder={c.timezonePlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {getTimezones().map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <Button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="w-full sm:w-auto"
          >
            {saving ? c.saving : c.save}
          </Button>
          {cadence !== "off" && !timezoneChosen ? (
            <p className="text-xs text-muted-foreground">{c.timezoneMissing}</p>
          ) : null}

          {saveFeedback && (
            <Notice kind={saveFeedback.kind === "error" ? "error" : "ok"}>
              {saveFeedback.message}
            </Notice>
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
                {sendingTest ? c.sending : c.sendTest}
              </Button>
              {testFeedback && (
                <Notice kind={testFeedback.kind === "error" ? "error" : "ok"}>
                  {testFeedback.message}
                </Notice>
              )}
            </div>
          )}
        </>
      )}
      {embedded && onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {d.config.shared.cancel}
        </Button>
      ) : null}
    </Wrapper>
  );
}

function CardBody({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function EmbeddedBody({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 space-y-4">{children}</div>;
}
