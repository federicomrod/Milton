// components/restaurant/shell/DataHealthIndicator.tsx
//
// Compact "● Salud de los datos: 2 asuntos" that opens a drawer.
// Items are computed on the backend — the UI never guesses.

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { DATA_SETTINGS_HREF } from "@/lib/restaurant/navigation";
import type {
  CockpitDataHealth,
  DataHealthItem,
  DataHealthTone,
} from "@/lib/restaurant/cockpit-data-health";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type { DataHealthTone };

export function DataHealthIndicator({
  lang = "es",
  health,
}: {
  lang?: PreferredLanguage;
  health: CockpitDataHealth;
}) {
  const label = issueLabel(lang, health.issue_count);
  const toneClass =
    health.tone === "error"
      ? "text-red-800 dark:text-red-200"
      : health.tone === "warn"
        ? "text-amber-800 dark:text-amber-200"
        : "text-muted-foreground";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="data-health-indicator"
          className={
            "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 " +
            toneClass
          }
        >
          <span aria-hidden className={dotClass(health.tone)}>
            ●
          </span>
          {label}
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="data-health-drawer"
        className="fixed top-0 right-0 left-auto bottom-0 h-full max-h-full w-full sm:max-w-md translate-x-0 translate-y-0 rounded-none border-l p-0 gap-0 overflow-y-auto"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle>
            {t(lang, "Data health", "Salud de los datos")}
          </DialogTitle>
          <DialogDescription>
            {t(
              lang,
              "Readiness of the numbers on this page. The UI does not guess missing values.",
              "Estado de los números de esta página. La interfaz no inventa valores faltantes."
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="px-5 py-4 space-y-3">
          {health.items.map((item) => (
            <HealthRow key={item.id} item={item} />
          ))}
        </ul>
        <p className="px-5 pb-5 text-xs text-muted-foreground">
          <Link
            href={DATA_SETTINGS_HREF}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
          >
            {t(lang, "Open Data & Settings →", "Abrir Datos y configuración →")}
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function HealthRow({ item }: { item: DataHealthItem }) {
  return (
    <li className="text-sm">
      <p
        className="font-medium inline-flex items-center gap-1.5"
        title={item.tooltip}
      >
        <span aria-hidden className={dotClass(item.tone)}>
          ●
        </span>
        {item.label}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5 pl-4">{item.detail}</p>
    </li>
  );
}

function issueLabel(lang: PreferredLanguage, count: number): string {
  if (count <= 0) {
    return t(lang, "Data health: up to date", "Salud de los datos: al día");
  }
  if (count === 1) {
    return t(lang, "Data health: 1 issue", "Salud de los datos: 1 asunto");
  }
  return t(
    lang,
    `Data health: ${count} issues`,
    `Salud de los datos: ${count} asuntos`
  );
}

function dotClass(tone: DataHealthTone): string {
  if (tone === "error") return "text-red-600";
  if (tone === "warn") return "text-amber-600";
  return "text-emerald-600";
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
      <span>{children}</span>
    </div>
  );
}
