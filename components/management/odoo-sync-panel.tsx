"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/components/ui/use-toast";
import {
  MAX_RANGE_DAYS,
  parseInclusiveDateRange,
} from "@/lib/restaurant/odoo/sync-window";
import {
  compactLastSync,
  formatLastSyncLine,
  summarizeOdooSync,
  syncSummaryCopy,
  type OdooLastSync,
  type OdooSyncSuccessBody,
  type OdooSyncSummaryView,
} from "@/lib/restaurant/odoo/sync-summary";
import { safeSyncErrorMessage } from "@/lib/restaurant/odoo/sync-error";
import {
  DEFAULT_SYNC_PRESET,
  SYNC_DATE_PRESETS,
  createInFlightGuard,
  rangeForPreset,
  type SyncDatePreset,
} from "@/lib/restaurant/odoo/sync-control";

interface OdooSyncPanelProps {
  lastSync?: OdooLastSync | null;
}

export function OdooSyncPanel({ lastSync = null }: OdooSyncPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const defaultRange = rangeForPreset(DEFAULT_SYNC_PRESET);
  const [preset, setPreset] = useState<SyncDatePreset | "custom">(
    DEFAULT_SYNC_PRESET
  );
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OdooSyncSummaryView | null>(null);
  const [storedLastSync, setStoredLastSync] = useState<OdooLastSync | null>(
    lastSync
  );
  const guardRef = useRef(createInFlightGuard());

  useEffect(() => {
    setStoredLastSync(lastSync);
  }, [lastSync]);

  const applyPreset = (next: SyncDatePreset) => {
    const range = rangeForPreset(next);
    setPreset(next);
    setStartDate(range.start);
    setEndDate(range.end);
    setError(null);
  };

  const onDateChange = (which: "start" | "end", value: string) => {
    setPreset("custom");
    if (which === "start") setStartDate(value);
    else setEndDate(value);
  };

  const handleSync = async () => {
    const result = await guardRef.current.run(async () => {
      const parsed = parseInclusiveDateRange(startDate, endDate);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }

      setSyncing(true);
      setError(null);

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
          setSummary(null);
          setError(safeSyncErrorMessage(response.status, body));
          return;
        }

        const view = summarizeOdooSync(body as OdooSyncSuccessBody);
        setSummary(view);
        setStoredLastSync(compactLastSync(body as OdooSyncSuccessBody));
        toast({
          title: "Sales updated",
          description: syncSummaryCopy(view).headline,
        });
        window.dispatchEvent(new CustomEvent("milton:pos-data-updated"));
        router.refresh();
      } catch {
        setSummary(null);
        setError(safeSyncErrorMessage(0, {}));
      } finally {
        setSyncing(false);
      }
    });

    if (!result.started) return;
  };

  const copy = summary ? syncSummaryCopy(summary) : null;
  const lastSyncLine = storedLastSync
    ? formatLastSyncLine(storedLastSync)
    : "Not synced yet. Pick a date range and click Sync now.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync sales from Odoo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pull completed POS orders into Milton. You can sync at most{" "}
          {MAX_RANGE_DAYS} days at a time. This updates the workspace you are
          signed into.
        </p>

        <div>
          <Label className="mb-2 block">Quick range</Label>
          <div className="flex flex-wrap gap-2">
            {SYNC_DATE_PRESETS.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={preset === item.id ? "default" : "outline"}
                onClick={() => applyPreset(item.id)}
                disabled={syncing}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="odoo-sync-start">Start date</Label>
            <Input
              id="odoo-sync-start"
              type="date"
              value={startDate}
              onChange={(e) => onDateChange("start", e.target.value)}
              disabled={syncing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="odoo-sync-end">End date</Label>
            <Input
              id="odoo-sync-end"
              type="date"
              value={endDate}
              onChange={(e) => onDateChange("end", e.target.value)}
              disabled={syncing}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleSync}
            disabled={syncing || !startDate || !endDate}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          {syncing && (
            <p className="text-sm text-muted-foreground">
              Syncing sales… a full month can take a minute.
            </p>
          )}
        </div>

        <p
          className="text-sm text-muted-foreground"
          data-testid="odoo-last-sync"
        >
          {lastSyncLine}
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {copy && summary && <OdooSyncSummaryCard view={summary} copy={copy} />}
      </CardContent>
    </Card>
  );
}

function OdooSyncSummaryCard({
  view,
  copy,
}: {
  view: OdooSyncSummaryView;
  copy: ReturnType<typeof syncSummaryCopy>;
}) {
  return (
    <div className="space-y-3 rounded-md border p-4 text-sm">
      <p className="font-medium">{copy.headline}</p>
      {copy.outsideRange && (
        <p className="text-muted-foreground">{copy.outsideRange}</p>
      )}

      <Collapsible>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>{copy.skipped}</p>
          {view.skippedCount > 0 && (
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                Show reasons
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        {view.skippedCount > 0 && (
          <CollapsibleContent>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {view.skippedGroups.map((group) => (
                <li key={group.reason}>
                  {group.reason} ({group.count})
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>

      <Collapsible>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>{copy.unmatchedItems}</p>
          {view.unmatchedMenuItemCount > 0 && (
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                Show list
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        {view.unmatchedMenuItemCount > 0 && (
          <CollapsibleContent>
            <ul className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 text-muted-foreground">
              {view.unmatchedMenuItems.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>

      <div>
        <p>{copy.unmatchedTills}</p>
        {view.unmatchedLocations.length > 0 && (
          <>
            <p className="mt-1 text-muted-foreground">
              {copy.unmatchedTillsNote}
            </p>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {view.unmatchedLocations.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {view.warnings.length > 0 && (
        <div>
          <p className="font-medium">Warnings</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {view.warnings.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
