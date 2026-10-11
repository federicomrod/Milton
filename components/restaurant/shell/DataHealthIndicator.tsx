// components/restaurant/shell/DataHealthIndicator.tsx
//
// Small page-level control that hides system-language banners
// ("rows loaded", "Supabase", live-vs-sample copy) behind a "Data health"
// disclosure. Full Data Health drawer arrives in PR 2 (#129). Nothing
// is deleted — the existing copy lives here.

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { DATA_SETTINGS_HREF } from "@/lib/restaurant/navigation";

export type DataHealthTone = "ok" | "warn" | "error";

export function DataHealthIndicator({
  lang = "en",
  tone = "ok",
  children,
}: {
  lang?: PreferredLanguage;
  tone?: DataHealthTone;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const label = t(lang, "Data health", "Salud de los datos");
  const toneClass =
    tone === "error"
      ? "text-red-800 dark:text-red-200"
      : tone === "warn"
        ? "text-amber-800 dark:text-amber-200"
        : "text-muted-foreground";
  const Icon = tone === "ok" ? Info : AlertTriangle;

  return (
    <div data-testid="data-health-indicator" className="text-sm">
      <button
        type="button"
        className={
          "inline-flex items-center gap-1 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm " +
          toneClass
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        <ChevronDown
          className={
            "h-3 w-3 transition-transform " + (open ? "rotate-180" : "")
          }
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {children}
          <p className="text-xs text-muted-foreground">
            <Link
              href={DATA_SETTINGS_HREF}
              className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
            >
              {t(lang, "Open Data & Settings →", "Abrir Datos y ajustes →")}
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function DataHealthBanner({
  tone,
  children,
}: {
  tone: DataHealthTone;
  children: ReactNode;
}) {
  const box =
    tone === "error"
      ? "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-900 dark:text-red-200"
      : tone === "warn"
        ? "border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200"
        : "border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 text-green-900 dark:text-green-200";
  return (
    <div
      className={
        "rounded-md border py-1.5 px-3 text-sm flex items-start gap-2 " + box
      }
    >
      {tone === "ok" ? (
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      )}
      <span>{children}</span>
    </div>
  );
}
