"use client";
// components/restaurant/onboarding/SelectableCard.tsx
//
// Large, tappable selection card used throughout the restaurant onboarding
// wizard (concept type, location count, POS system, priorities). A plain
// <button> under the hood — real focus/keyboard/tap semantics for free,
// no extra a11y wiring needed. Deliberately not built on ToggleGroup: this
// needs to work standalone for both single- and capped-multi-select steps
// with one shared visual language.

import type { ComponentType } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectableCardProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  className?: string;
}

export function SelectableCard({
  label,
  selected,
  onClick,
  icon: Icon,
  disabled,
  className,
}: SelectableCardProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-5 text-center transition-all duration-150",
        "hover:border-primary/50 hover:bg-accent/50 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card",
        disabled &&
          "cursor-not-allowed opacity-40 hover:border-border hover:bg-card",
        className
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
      {Icon && (
        <Icon
          className={cn(
            "h-6 w-6",
            selected ? "text-primary" : "text-muted-foreground"
          )}
        />
      )}
      <span
        className={cn(
          "text-sm leading-tight font-medium",
          selected ? "text-primary" : "text-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );
}
