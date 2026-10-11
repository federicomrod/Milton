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
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
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
  const label = t(lang, "Sync", "Sincronizar");

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
        title: t(lang, "Could not sync", "No se pudo sincronizar"),
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
            title: t(lang, "Sync failed", "La sincronización no se completó"),
            description: safeSyncErrorMessageForLang(
              lang,
              response.status,
              body
            ),
            variant: "destructive",
          });
          return;
        }

        const view = summarizeOdooSync(body as OdooSyncSuccessBody);
        compactLastSync(body as OdooSyncSuccessBody);
        toast({
          title: t(lang, "Sales updated", "Ventas actualizadas"),
          description: syncSummaryCopy(view).headline,
        });
        window.dispatchEvent(new CustomEvent("milton:pos-data-updated"));
        router.refresh();
        setOpen(false);
      } catch {
        toast({
          title: t(lang, "Sync failed", "La sincronización no se completó"),
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
          aria-label={t(
            lang,
            "Confirm sync range",
            "Confirmar rango de sincronización"
          )}
          data-testid="sync-confirm-popover"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-background p-3 shadow-md space-y-2"
        >
          <p className="text-xs text-muted-foreground">
            {t(
              lang,
              "Sync pulls this range from Odoo. It is not the period shown on the page.",
              "La sincronización trae este rango de Odoo. No es el periodo que ves en la página."
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">
                {t(lang, "From", "Desde")}
              </span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
                aria-label={t(lang, "From date", "Desde")}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">
                {t(lang, "To", "Hasta")}
              </span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
                aria-label={t(lang, "To date", "Hasta")}
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
              {t(lang, "Cancel", "Cancelar")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              {t(lang, "Sync now", "Sincronizar ahora")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
