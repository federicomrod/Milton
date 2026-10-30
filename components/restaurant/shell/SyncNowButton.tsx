// components/restaurant/shell/SyncNowButton.tsx
//
// Secondary outlined Sync. Uses its OWN date window (last 31 days ending
// today), confirmed in a small popover — not the header period chip.
// Non-admins do not see the button.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";
import { parseInclusiveDateRange } from "@/lib/restaurant/odoo/sync-window";
import {
  compactLastSync,
  summarizeOdooSync,
  syncSummaryCopy,
  type OdooSyncSuccessBody,
} from "@/lib/restaurant/odoo/sync-summary";
import {
  localizedRangeParseError,
  safeSyncErrorMessageForLang,
} from "@/lib/restaurant/odoo/sync-error";
import {
  createInFlightGuard,
  defaultSyncWindow,
} from "@/lib/restaurant/odoo/sync-control";
import { syncButtonHidden } from "@/lib/restaurant/sync-visibility";

export function SyncNowButton({
  lang = "es",
  isAdmin,
}: {
  lang?: PreferredLanguage;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const guardRef = useRef(createInFlightGuard());
  const panelRef = useRef<HTMLDivElement>(null);
  const d = getDictionary(lang).shell.sync;
  const label = d.label;

  function openConfirm() {
    if (!from || !to) {
      const win = defaultSyncWindow(new Date());
      setFrom(win.start);
      setTo(win.end);
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (
        panelRef.current &&
        ev.target instanceof Node &&
        !panelRef.current.contains(ev.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (syncButtonHidden(isAdmin)) return null;

  const handleSync = async () => {
    const parsed = parseInclusiveDateRange(from, to);
    if (!parsed.ok) {
      toast({
        title: d.couldNot,
        description: localizedRangeParseError(lang, parsed.error),
        variant: "destructive",
      });
      return;
    }

    const result = await guardRef.current.run(async () => {
      setSyncing(true);
      try {
        const response = await fetch("/api/restaurant/pos/odoo-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_date: parsed.start_date,
            end_date: parsed.end_date,
          }),
        });

        let body: unknown = {};
        try {
          body = await response.json();
        } catch {
          body = {};
        }

        if (!response.ok) {
          toast({
            title: d.failed,
            description: safeSyncErrorMessageForLang(
              lang,
              response.status,
              body
            ),
            variant: "destructive",
          });
          return;
        }

        const view = summarizeOdooSync(body as OdooSyncSuccessBody, lang);
        compactLastSync(body as OdooSyncSuccessBody);
        toast({
          title: d.updated,
          description: syncSummaryCopy(view, lang).headline,
        });
        window.dispatchEvent(new CustomEvent("milton:pos-data-updated"));
        router.refresh();
        setOpen(false);
      } catch {
        toast({
          title: d.failed,
          description: safeSyncErrorMessageForLang(lang, 0, {}),
          variant: "destructive",
        });
      } finally {
        setSyncing(false);
      }
    });

    if (!result.started) return;
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="header-sync-button"
        data-admin="true"
        disabled={syncing}
        onClick={openConfirm}
        className="h-8 gap-1.5"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={d.confirmRange}
          data-testid="sync-confirm-popover"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-background p-3 shadow-md space-y-2"
        >
          <p className="text-xs text-muted-foreground">{d.hint}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[12px] text-muted-foreground">
                {d.from}
              </span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
                aria-label={d.from}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] text-muted-foreground">{d.to}</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
                aria-label={d.to}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setOpen(false)}
            >
              {getDictionary(lang).common.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              {d.syncNow}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
