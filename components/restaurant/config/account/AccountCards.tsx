"use client";

// Configuración › Mi cuenta. Read-only rows on load; «Editar» opens each form
// in place (name, password, briefing email, Telegram briefing).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { useCan } from "@/components/restaurant/shell/shell-chrome-context";
import { ConfigValue } from "../ConfigSection";
import {
  EditorButtons,
  InlineEditCard,
  useInlineEditor,
} from "../InlineEditCard";
import { EmailBriefingCard } from "@/components/restaurant/EmailBriefingCard";
import { TelegramConnectionCard } from "@/components/restaurant/TelegramConnectionCard";
import { Notice } from "./Notice";
import { changePassword, saveFullName } from "./save-name";

export const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  "h-10 w-full min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

export interface AccountCardsProps {
  name: string;
  email: string;
  /** ISO date the account was created. */
  createdAt: string | null;
  billingStatus: string | null;
}

export function AccountCards({
  name,
  email,
  createdAt,
  billingStatus,
}: AccountCardsProps) {
  const { d, locale } = useT();
  const a = d.config.account;
  const s = d.config.shared;
  const [shownName, setShownName] = useState(name);

  const since = createdAt
    ? new Date(createdAt).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="space-y-5">
      <InlineEditCard
        summary={
          <ConfigValue label={a.name} value={shownName} missing={s.missing} />
        }
      >
        <NameForm initial={shownName} onSaved={setShownName} />
      </InlineEditCard>

      <dl className="space-y-1">
        <ConfigValue label={a.email} value={email} missing={s.missing} />
        <p className="text-[13px] text-[#64748B]">{a.emailNote}</p>
      </dl>

      <InlineEditCard
        editLabel={a.changePassword}
        summary={
          <ConfigValue
            label={a.password}
            value="••••••••"
            missing={s.missing}
          />
        }
      >
        <PasswordForm />
      </InlineEditCard>

      <dl className="space-y-2">
        <ConfigValue
          label={a.plan}
          value={billingStatus || a.freeTrial}
          missing={s.missing}
        />
        <ConfigValue label={a.memberSince} value={since} missing={s.missing} />
      </dl>

      <Notifications />
    </div>
  );
}

function NameForm({
  initial,
  onSaved,
}: {
  initial: string;
  onSaved: (name: string) => void;
}) {
  const { d } = useT();
  const a = d.config.account;
  const editor = useInlineEditor();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    editor.setDirty(value.trim() !== initial.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError(a.nameRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveFullName(value);
      onSaved(value.trim());
      editor.saved();
      router.refresh();
    } catch {
      setError(a.nameFailed);
      editor.failed(a.nameFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-[13px] text-[#64748B]">
        {a.name}
        <input
          className={inputClass}
          value={value}
          maxLength={120}
          autoComplete="name"
          placeholder={a.nameHint}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <EditorButtons saving={saving} onCancel={editor.close} />
    </form>
  );
}

function PasswordForm() {
  const { d } = useT();
  const a = d.config.account;
  const editor = useInlineEditor();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    editor.setDirty(next !== "" || confirm !== "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, confirm]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(a.passwordShort);
      return;
    }
    if (next !== confirm) {
      setError(a.passwordMismatch);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(next);
      setNext("");
      setConfirm("");
      editor.saved(a.passwordChanged);
    } catch {
      // Typed values stay; the password is never logged or echoed.
      setError(a.passwordFailed);
      editor.failed(a.passwordFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-[13px] text-[#64748B]">
        {a.newPassword}
        <input
          type="password"
          className={inputClass}
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className="block space-y-1 text-[13px] text-[#64748B]">
        {a.confirmPassword}
        <input
          type="password"
          className={inputClass}
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <EditorButtons saving={saving} onCancel={editor.close} />
    </form>
  );
}

interface EmailPrefs {
  cadence: "off" | "daily" | "weekly";
  recipient: string | null;
  weekday: number;
  timezone: string;
}

type Loaded<T> =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; value: T };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Notifications() {
  const { d } = useT();
  const a = d.config.account;
  const s = d.config.shared;
  const canEdit = useCan("company.edit");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const [email, setEmail] = useState<Loaded<EmailPrefs>>({ state: "loading" });
  const [telegram, setTelegram] = useState<Loaded<boolean>>({
    state: "loading",
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      const [e, t] = await Promise.all([
        getJson<EmailPrefs>("/api/restaurant/briefing/email/preferences"),
        getJson<{ connected: boolean }>("/api/restaurant/telegram/connection"),
      ]);
      if (!live) return;
      setEmail(e ? { state: "ok", value: e } : { state: "error" });
      setTelegram(
        t ? { state: "ok", value: Boolean(t.connected) } : { state: "error" }
      );
    })();
    return () => {
      live = false;
    };
  }, [tick]);

  let emailText: string | null = null;
  if (email.state === "ok") {
    const p = email.value;
    if (p.cadence === "off") emailText = a.off;
    else {
      const parts = [p.cadence === "daily" ? a.daily : a.weekly];
      if (p.cadence === "weekly") {
        const day = d.comms.emailCard.weekdays[p.weekday];
        if (day) parts.push(day);
      }
      if (p.timezone) parts.push(p.timezone);
      if (p.recipient) parts.push(p.recipient);
      emailText = parts.join(" · ");
    }
  } else if (email.state === "error") emailText = a.loadFailed;

  let telegramText: string | null = null;
  if (telegram.state === "ok")
    telegramText = telegram.value ? a.connected : a.notConnected;
  else if (telegram.state === "error") telegramText = a.loadFailed;

  return (
    <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
      <h3 className="text-sm font-semibold">{a.notifications}</h3>
      <InlineEditCard
        canEdit={canEdit}
        readOnlyNote={s.readOnly}
        summary={
          <ConfigValue
            label={a.briefingEmail}
            value={email.state === "loading" ? "…" : emailText}
            missing={s.missing}
          />
        }
      >
        <EmailEditor onDone={refresh} />
      </InlineEditCard>
      <InlineEditCard
        canEdit={canEdit}
        readOnlyNote={s.readOnly}
        summary={
          <ConfigValue
            label={a.briefingTelegram}
            value={telegram.state === "loading" ? "…" : telegramText}
            missing={s.missing}
          />
        }
      >
        <TelegramEditor onDone={refresh} />
      </InlineEditCard>
    </div>
  );
}

function EmailEditor({ onDone }: { onDone: () => void }) {
  const editor = useInlineEditor();
  return (
    <EmailBriefingCard
      embedded
      onDirty={editor.setDirty}
      onSaved={() => {
        editor.saved();
        onDone();
      }}
      onCancel={editor.close}
    />
  );
}

function TelegramEditor({ onDone }: { onDone: () => void }) {
  const editor = useInlineEditor();
  return (
    <TelegramConnectionCard
      embedded
      onClose={() => {
        editor.close();
        onDone();
      }}
    />
  );
}
