"use client";

// «Modo soporte · {empresa}» + «Salir», on every page of the shell while a
// Milton admin is inside a client account through a support membership.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";
import { exitSupportAction } from "@/app/dashboard/restaurant/support-actions";

export function SupportBanner() {
  const { supportCompanyName } = useRestaurantShellChrome();
  const { d, fmt } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!supportCompanyName) return null;
  const b = d.support.banner;

  const exit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await exitSupportAction();
      if (res.ok) {
        // A full navigation, so nothing of the client's data stays cached.
        window.location.assign("/management/clients");
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <div
      role="status"
      data-testid="support-banner"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 bg-[#1B40C8] px-4 py-2 text-sm font-semibold text-white"
    >
      <span className="min-w-0 break-words">
        {fmt(b.label, { company: supportCompanyName })}
      </span>
      <span className="flex items-center gap-3">
        {failed ? <span className="font-normal">{b.exitFailed}</span> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void exit()}
          className="rounded-md border border-white px-3 py-1 text-sm font-semibold hover:bg-white hover:text-[#1B40C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
        >
          {busy ? b.exiting : b.exit}
        </button>
      </span>
    </div>
  );
}
