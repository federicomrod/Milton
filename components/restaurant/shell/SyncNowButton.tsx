// components/restaurant/shell/SyncNowButton.tsx
//
// Secondary outlined Sync on the operating-page header. Reuses the
// existing POST /api/restaurant/pos/odoo-sync + in-flight guard +
// plain-language toast from /management/odoo. Non-admins get a disabled
// button with a tooltip — never an error.

"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { parseInclusiveDateRange } from "@/lib/restaurant/odoo/sync-window";
import {
  compactLastSync,
  summarizeOdooSync,
  syncSummaryCopy,
  type OdooSyncSuccessBody,
} from "@/lib/restaurant/odoo/sync-summary";
import { safeSyncErrorMessage } from "@/lib/restaurant/odoo/sync-error";
import { createInFlightGuard } from "@/lib/restaurant/odoo/sync-control";
import { parsePageDateRange } from "@/lib/restaurant/page-date-range";
import { syncButtonDisabled } from "@/lib/restaurant/sync-visibility";

export function SyncNowButton({
  lang = "en",
  isAdmin,
}: {
  lang?: PreferredLanguage;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const guardRef = useRef(createInFlightGuard());
  const disabled = syncButtonDisabled(isAdmin) || syncing;
  const label = t(lang, "Sync", "Sincronizar");
  const nonAdminHint = t(
    lang,
    "Only Milton admins can sync POS data.",
    "Solo los administradores de Milton pueden sincronizar el POS."
  );

  const handleSync = async () => {
    if (syncButtonDisabled(isAdmin)) return;
    const range = parsePageDateRange(searchParams);
    const result = await guardRef.current.run(async () => {
      const parsed = parseInclusiveDateRange(range.from, range.to);
      if (!parsed.ok) {
        toast({
          title: t(lang, "Could not sync", "No se pudo sincronizar"),
          description: parsed.error,
          variant: "destructive",
        });
        return;
      }

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
            title: t(lang, "Sync failed", "Sincronización fallida"),
            description: safeSyncErrorMessage(response.status, body),
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
      } catch {
        toast({
          title: t(lang, "Sync failed", "Sincronización fallida"),
          description: safeSyncErrorMessage(0, {}),
          variant: "destructive",
        });
      } finally {
        setSyncing(false);
      }
    });

    if (!result.started) return;
  };

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="header-sync-button"
      data-admin={isAdmin ? "true" : "false"}
      disabled={disabled}
      onClick={handleSync}
      className="h-8 gap-1.5"
      aria-label={label}
    >
      {syncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );

  if (isAdmin) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{nonAdminHint}</TooltipContent>
    </Tooltip>
  );
}
