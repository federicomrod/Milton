"use client";

// «Correo confirmado»: shown once, after /auth/callback sends a freshly
// confirmed user into the app with ?confirmed=1. The param is removed from the
// address bar so a reload does not show it again.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/client";

export function ConfirmedNotice() {
  const { d } = useT();
  const flag = useSearchParams().get("confirmed") === "1";
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) return;
    queueMicrotask(() => setShown(true));
    const url = new URL(window.location.href);
    url.searchParams.delete("confirmed");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
    const t = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(t);
  }, [flag]);
  if (!shown) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-4 py-2 text-sm font-semibold text-[#1f7a45] shadow-md"
    >
      ✓ {d.auth.confirmedNotice}
    </div>
  );
}
