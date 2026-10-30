// components/restaurant/shell/DataHealthIndicator.tsx
//
// Compact "● Salud de los datos: 2 asuntos" that opens a drawer.
// Items are computed on the backend — the UI never guesses.

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { fmt, getDictionary } from "@/lib/i18n";
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
  const d = getDictionary(lang).shell.health;
  const label = issueLabel(d, health.issue_count);
  const toneClass =
    health.tone === "error"
      ? "text-red-800 dark:text-red-200"
      : health.tone === "warn"
        ? "text-gray-700 dark:text-gray-400"
        : "text-muted-foreground";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="data-health-indicator"
          className={
            "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] " +
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
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description}</DialogDescription>
        </DialogHeader>
        <ul className="px-5 py-4 space-y-3">
          {health.items.map((item) => (
            <HealthRow key={item.id} item={item} />
          ))}
        </ul>
        <p className="px-5 pb-5 text-xs text-muted-foreground">
          <Link
            href={DATA_SETTINGS_HREF}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] rounded-sm"
          >
            {d.openSettings}
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

function issueLabel(
  d: ReturnType<typeof getDictionary>["shell"]["health"],
  count: number
): string {
  if (count <= 0) return d.upToDate;
  if (count === 1) return d.one;
  return fmt(d.many, { n: count });
}

function dotClass(tone: DataHealthTone): string {
  if (tone === "error") return "text-red-600";
  if (tone === "warn") return "text-gray-500";
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
        ? "border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/20 text-gray-700 dark:text-gray-400"
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
