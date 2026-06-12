// components/restaurant/BriefingCard.tsx
//
// Compact "Milton Briefing" card shown at the top of the Cockpit Overview tab.
//
// Loads /api/restaurant/briefing on mount, shows the headline / summary /
// top 3 actions, and a refresh button. The badge tells the user whether the
// wording came from OpenAI or the deterministic fallback so they always know
// what they're reading.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types — kept local to avoid bundling server-only modules into the client.
// ---------------------------------------------------------------------------

interface BriefingPayload {
  source: "openai" | "deterministic";
  generated_at: string;
  context_summary: {
    restaurant_name: string;
    period_label: string;
    currency: string;
    revenue: number;
    orders: number | null;
    cost_coverage_pct: number;
    estimated_gross_margin_pct: number | null;
    food_cost_pct: number | null;
    open_recommendations_total: number;
    open_recommendations_critical: number;
  };
  briefing: {
    headline: string;
    summary: string;
    top_risks: string[];
    top_opportunities: string[];
    recommended_actions: string[];
    confidence_notes: string[];
  };
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BriefingCard() {
  const [data, setData] = useState<BriefingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/briefing", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(body as BriefingPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-orange-200 dark:border-orange-900/50 bg-orange-50/30 dark:bg-orange-950/10">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40 shrink-0">
            <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-300" />
          </span>

          <div className="flex-1 min-w-0 space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">Milton Briefing</span>
              {data && (
                <Badge
                  variant="outline"
                  className={
                    "text-[10px] uppercase tracking-wide " +
                    (data.source === "openai"
                      ? "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                      : "border-border text-muted-foreground")
                  }
                >
                  {data.source === "openai" ? (
                    <>
                      <Sparkles className="h-3 w-3 inline mr-1" />
                      AI briefing
                    </>
                  ) : (
                    <>
                      <Cpu className="h-3 w-3 inline mr-1" />
                      Rule-based briefing
                    </>
                  )}
                </Badge>
              )}
              {data && (
                <span className="text-[11px] text-muted-foreground">
                  · {fmtRelative(data.generated_at)}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 text-xs gap-1"
                onClick={load}
                disabled={loading}
                title="Refresh briefing"
              >
                <RefreshCw
                  className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")}
                />
                Refresh
              </Button>
            </div>

            {/* Loading / error / content */}
            {loading && !data && (
              <p className="text-sm text-muted-foreground">
                Reading your latest restaurant numbers…
              </p>
            )}
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Could not load briefing: {error}
              </p>
            )}

            {data && (
              <>
                <p className="text-sm font-semibold leading-snug">
                  {data.briefing.headline}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {data.briefing.summary}
                </p>

                {data.briefing.recommended_actions.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                      Recommended actions
                    </p>
                    <ul className="space-y-1 text-sm">
                      {data.briefing.recommended_actions
                        .slice(0, 3)
                        .map((action, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-foreground/90"
                          >
                            <span className="text-orange-500 mt-1 shrink-0">
                              •
                            </span>
                            <span>{action}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {data.briefing.confidence_notes.length > 0 && (
                  <p className="text-[11px] text-muted-foreground italic">
                    {data.briefing.confidence_notes[0]}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
