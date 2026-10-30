"use client";

// «Reenviar correo» with a ~60 s cooldown and success / error feedback.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import {
  RESEND_COOLDOWN_SECONDS,
  resendConfirmation,
} from "@/lib/auth/email-confirmation";

export function ResendConfirmation({
  email,
  label,
  variant = "outline",
  startCooldown = false,
}: {
  email: string;
  label?: string;
  variant?: "outline" | "link";
  /** The email was JUST sent (signup): the button starts cooling down. */
  startCooldown?: boolean;
}) {
  const { d, lang, fmt } = useT();
  const shownLabel = label ?? d.auth.resend.label;
  const [left, setLeft] = useState(startCooldown ? RESEND_COOLDOWN_SECONDS : 0);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function resend() {
    setSending(true);
    setNote(null);
    const result = await resendConfirmation(createClient(), email, lang);
    setSending(false);
    if (result.ok) {
      setNote({ ok: true, text: fmt(d.auth.resend.done, { email }) });
      setLeft(RESEND_COOLDOWN_SECONDS);
    } else {
      setNote({ ok: false, text: result.message });
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        className={variant === "outline" ? "w-full" : "h-auto p-0"}
        disabled={sending || left > 0}
        onClick={() => void resend()}
      >
        {sending
          ? d.auth.resend.sending
          : left > 0
            ? `${shownLabel} (${left} s)`
            : shownLabel}
      </Button>
      {note ? (
        <p
          role={note.ok ? "status" : "alert"}
          className={
            "text-sm " + (note.ok ? "text-green-700" : "text-destructive")
          }
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
