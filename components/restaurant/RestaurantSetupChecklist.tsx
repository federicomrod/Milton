"use client";
// components/restaurant/RestaurantSetupChecklist.tsx
//
// Control-tower readiness panel shown near the top of the cockpit when the
// restaurant's setup is incomplete. Hides when all core steps are done.
//
// The 7 steps guide the user along the value journey:
//   POS sales → ingredient costs → menu/mappings → recipes → invoices → agents → Ask Milton
//
// Status logic:
//   done    — step is fully complete
//   review  — step started but has open issues
//   missing — step not started at all
//
// "Ask Milton" is always shown as an exploration CTA, not a checkable step.
//
// Collapse behaviour:
//   - Default: expanded when fewer than 4 steps are done; collapsed otherwise.
//   - User can toggle at any time; state is persisted to localStorage.
//   - Collapsed view shows title + progress bar + step count.

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  SetupCounts,
  DataQualityCounts,
} from "@/lib/restaurant/profitability-server";

const LS_KEY = "restaurantSetupChecklistCollapsed";

type StepStatus = "done" | "review" | "missing";

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  href: string;
  cta: string;
  status: StepStatus;
}

function deriveSteps(s: SetupCounts, dq: DataQualityCounts): ChecklistStep[] {
  return [
    {
      id: "pos",
      label: "Upload POS sales",
      description:
        s.pos_sales_count > 0
          ? `${s.pos_sales_count.toLocaleString()} sale rows loaded from your POS export.`
          : "Upload your POS export to unlock revenue analytics and item performance.",
      href: "/dashboard/restaurant/upload",
      cta: "Import POS Sales",
      status: s.pos_sales_count > 0 ? "done" : "missing",
    },
    {
      id: "costs",
      label: "Import ingredient costs",
      description:
        s.cost_entries_count > 0
          ? `${s.cost_entries_count.toLocaleString()} cost entries imported.`
          : "Add supplier prices to start calculating food cost and gross margin.",
      href: "/dashboard/restaurant/costs/upload",
      cta: "Import Costs",
      status: s.cost_entries_count > 0 ? "done" : "missing",
    },
    {
      id: "menu",
      label: "Review menu items & POS mappings",
      description:
        s.menu_items_count === 0
          ? "No menu items found. Visit the Menu page to create or sync your menu."
          : dq.unmapped_pos_items > 0
            ? `${dq.unmapped_pos_items} POS item${dq.unmapped_pos_items === 1 ? "" : "s"} not yet mapped to a menu item — link them to enable costing.`
            : "All POS items are mapped to menu items.",
      href: "/dashboard/restaurant/menu",
      cta: "Open Menu & Mappings",
      status:
        s.menu_items_count === 0
          ? "missing"
          : dq.unmapped_pos_items > 0
            ? "review"
            : "done",
    },
    {
      id: "recipes",
      label: "Create recipes & components",
      description:
        s.recipe_inputs_count === 0
          ? "No recipe inputs yet. Add ingredients to your recipes to unlock per-dish costing."
          : dq.menu_items_without_recipe > 0
            ? `${dq.menu_items_without_recipe} menu item${dq.menu_items_without_recipe === 1 ? "" : "s"} still missing a recipe — complete them to unlock full margin coverage.`
            : "All menu items have at least one recipe.",
      href: "/dashboard/restaurant/menu",
      cta: "Open Recipes",
      status:
        s.recipe_inputs_count === 0
          ? "missing"
          : dq.menu_items_without_recipe > 0
            ? "review"
            : "done",
    },
    {
      id: "invoices",
      label: "Upload or create supplier invoices",
      description:
        s.supplier_invoices_count > 0
          ? `${s.supplier_invoices_count} invoice${s.supplier_invoices_count === 1 ? "" : "s"} on record. Keep uploading to track supplier price trends.`
          : "Upload supplier invoices to auto-populate ingredient costs and enable price-change alerts.",
      href: "/dashboard/restaurant/invoices",
      cta: "Open Invoices",
      status: s.supplier_invoices_count > 0 ? "done" : "missing",
    },
    {
      id: "agents",
      label: "Run agents",
      description:
        s.agent_runs_count > 0
          ? `${s.agent_runs_count} agent run${s.agent_runs_count === 1 ? "" : "s"} completed. Schedule regular runs to keep recommendations fresh.`
          : "Run your first agent to get automated margin analysis and supplier alerts.",
      href: "/dashboard/restaurant/agents",
      cta: "Open Agents",
      status: s.agent_runs_count > 0 ? "done" : "missing",
    },
  ];
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "review")
    return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

function statusLabel(status: StepStatus): string {
  if (status === "done") return "Done";
  if (status === "review") return "Needs review";
  return "Not started";
}

function statusClass(status: StepStatus): string {
  if (status === "done") return "text-green-700 dark:text-green-400";
  if (status === "review") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export function RestaurantSetupChecklist({
  setupCounts,
  dataQuality,
}: {
  setupCounts: SetupCounts;
  dataQuality: DataQualityCounts;
}) {
  const steps = deriveSteps(setupCounts, dataQuality);
  const doneCount = steps.filter((s) => s.status === "done").length;

  // Smart default: collapse when mostly done (≥4/6). Expanded when fresh setup.
  const smartDefault = doneCount >= 4;

  // Initialize without reading localStorage to avoid SSR/hydration mismatch.
  const [collapsed, setCollapsed] = useState(smartDefault);

  // After mount, override with persisted user preference if one exists.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setCollapsed(stored === "true");
    } catch {
      // localStorage unavailable (private mode, etc.) — keep smart default.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  if (doneCount === steps.length) return null;

  const progressPct = Math.round((doneCount / steps.length) * 100);

  return (
    <Card className="border-orange-200 dark:border-orange-900/50 bg-orange-50/30 dark:bg-orange-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold">
              Set up your restaurant control tower
            </CardTitle>
            {collapsed ? (
              <p className="text-xs text-muted-foreground mt-1">
                {doneCount}/{steps.length} steps complete
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                Complete these steps to unlock recipe margins, supplier alerts,
                and Milton recommendations.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Progress bar + count */}
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {doneCount}/{steps.length}
              </span>
            </div>

            {/* Collapse toggle */}
            <button
              onClick={toggle}
              aria-label={
                collapsed
                  ? "Expand setup checklist"
                  : "Collapse setup checklist"
              }
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {collapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0">
          <ul className="divide-y divide-border/60">
            {steps.map((step) => (
              <li
                key={step.id}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="mt-0.5">
                  <StatusIcon status={step.status} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={
                        "text-sm font-medium " +
                        (step.status === "done"
                          ? "text-muted-foreground line-through decoration-muted-foreground/40"
                          : "text-foreground")
                      }
                    >
                      {step.label}
                    </span>
                    <span
                      className={
                        "text-xs font-medium " + statusClass(step.status)
                      }
                    >
                      {statusLabel(step.status)}
                    </span>
                  </div>
                  {step.status !== "done" && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                  )}
                </div>
                {step.status !== "done" && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-7 text-xs gap-1"
                  >
                    <Link href={step.href}>
                      {step.cta}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {/* Ask Milton — always shown as the final CTA regardless of checklist state */}
          <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <span className="mt-0.5">
                <Circle className="h-4 w-4 text-orange-400 shrink-0" />
              </span>
              <div>
                <span className="text-sm font-medium">
                  Ask Milton your first question
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Explore insights, get recommendations, or ask about margins,
                  suppliers, and trends.
                </p>
              </div>
            </div>
            <Button
              asChild
              variant="default"
              size="sm"
              className="shrink-0 h-7 text-xs gap-1 bg-orange-600 hover:bg-orange-700"
            >
              <Link href="/dashboard/restaurant/briefing">
                Ask Milton
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
