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
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import {
  setupStepStatus,
  SETUP_STEP_HREFS,
  type SetupStepId,
} from "@/lib/restaurant/setup-progress";

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

function deriveSteps(
  s: SetupCounts,
  dq: DataQualityCounts,
  lang: PreferredLanguage
): ChecklistStep[] {
  return [
    {
      id: "pos",
      label: t(lang, "Upload POS sales", "Cargar ventas del POS"),
      description:
        s.pos_sales_count > 0
          ? t(
              lang,
              `${s.pos_sales_count.toLocaleString("es-MX")} sale rows loaded from your POS export.`,
              `${s.pos_sales_count.toLocaleString("es-MX")} filas de ventas cargadas desde tu POS.`
            )
          : t(
              lang,
              "Upload your POS export to unlock revenue analytics and item performance.",
              "Sube tu exportación del POS para ver ventas e ítems."
            ),
      href: SETUP_STEP_HREFS.pos,
      cta: t(lang, "Import POS Sales", "Importar ventas del POS"),
      status: setupStepStatus("pos" satisfies SetupStepId, s, dq),
    },
    {
      id: "costs",
      label: t(
        lang,
        "Import ingredient costs",
        "Importar costos de ingredientes"
      ),
      description:
        s.cost_entries_count > 0
          ? t(
              lang,
              `${s.cost_entries_count.toLocaleString("es-MX")} cost entries imported.`,
              `${s.cost_entries_count.toLocaleString("es-MX")} costos importados.`
            )
          : t(
              lang,
              "Add supplier prices to start calculating food cost and gross margin.",
              "Agrega precios de proveedores para calcular costo de comida y margen."
            ),
      href: SETUP_STEP_HREFS.costs,
      cta: t(lang, "Import Costs", "Importar costos"),
      status: setupStepStatus("costs", s, dq),
    },
    {
      id: "menu",
      label: t(
        lang,
        "Review menu items & POS mappings",
        "Revisar platillos y ligues del POS"
      ),
      description:
        s.menu_items_count === 0
          ? t(
              lang,
              "No menu items found. Visit the Menu page to create or sync your menu.",
              "No hay platillos. Ve a Menú para crearlos o sincronizarlos."
            )
          : dq.unmapped_pos_items > 0
            ? t(
                lang,
                `${dq.unmapped_pos_items} POS item${dq.unmapped_pos_items === 1 ? "" : "s"} not yet mapped to a menu item — link them to enable costing.`,
                `${dq.unmapped_pos_items} ${dq.unmapped_pos_items === 1 ? "platillo del POS no está ligado" : "platillos del POS no están ligados"} al menú. Lígales para poder costear.`
              )
            : t(
                lang,
                "All POS items are mapped to menu items.",
                "Todos los platillos del POS ya están ligados al menú."
              ),
      href: SETUP_STEP_HREFS.menu,
      cta: t(lang, "Open Menu & Mappings", "Abrir Menú y ligues"),
      status: setupStepStatus("menu", s, dq),
    },
    {
      id: "recipes",
      label: t(
        lang,
        "Create recipes & components",
        "Crear recetas y componentes"
      ),
      description:
        s.recipe_inputs_count === 0
          ? t(
              lang,
              "No recipe inputs yet. Add ingredients to your recipes to unlock per-dish costing.",
              "Aún no hay insumos de receta. Agrega ingredientes para costear cada platillo."
            )
          : dq.menu_items_without_recipe > 0
            ? t(
                lang,
                `${dq.menu_items_without_recipe} menu item${dq.menu_items_without_recipe === 1 ? "" : "s"} still missing a recipe — complete them to unlock full margin coverage.`,
                `${dq.menu_items_without_recipe} ${dq.menu_items_without_recipe === 1 ? "platillo todavía no tiene" : "platillos todavía no tienen"} receta. Complétalos para ver el margen completo.`
              )
            : t(
                lang,
                "All menu items have at least one recipe.",
                "Todos los platillos ya tienen al menos una receta."
              ),
      href: SETUP_STEP_HREFS.recipes,
      cta: t(lang, "Open Recipes", "Abrir Recetas"),
      status: setupStepStatus("recipes", s, dq),
    },
    {
      id: "invoices",
      label: t(
        lang,
        "Upload or create supplier invoices",
        "Subir o crear facturas de proveedores"
      ),
      description:
        s.supplier_invoices_count > 0
          ? t(
              lang,
              `${s.supplier_invoices_count} invoice${s.supplier_invoices_count === 1 ? "" : "s"} on record. Keep uploading to track supplier price trends.`,
              `${s.supplier_invoices_count} ${s.supplier_invoices_count === 1 ? "factura registrada" : "facturas registradas"}. Sigue subiendo para ver cambios de precio.`
            )
          : t(
              lang,
              "Upload supplier invoices to auto-populate ingredient costs and enable price-change alerts.",
              "Sube facturas de proveedores para llenar costos y ver alertas de precio."
            ),
      href: SETUP_STEP_HREFS.invoices,
      cta: t(lang, "Open Invoices", "Abrir Facturas"),
      status: setupStepStatus("invoices", s, dq),
    },
    {
      id: "agents",
      label: t(lang, "Run agents", "Correr agentes"),
      description:
        s.agent_runs_count > 0
          ? t(
              lang,
              `${s.agent_runs_count} agent run${s.agent_runs_count === 1 ? "" : "s"} completed. Schedule regular runs to keep recommendations fresh.`,
              `${s.agent_runs_count} ${s.agent_runs_count === 1 ? "corrida lista" : "corridas listas"}. Programa corridas para mantener las recomendaciones al día.`
            )
          : t(
              lang,
              "Run your first agent to get automated margin analysis and supplier alerts.",
              "Corre tu primer agente para ver análisis de margen y alertas de proveedores."
            ),
      href: SETUP_STEP_HREFS.agents,
      cta: t(lang, "Open Agents", "Abrir Agentes"),
      status: setupStepStatus("agents", s, dq),
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

function statusLabel(status: StepStatus, lang: PreferredLanguage): string {
  if (status === "done") return t(lang, "Done", "Listo");
  if (status === "review") return t(lang, "Needs review", "Hay que revisar");
  return t(lang, "Not started", "Sin empezar");
}

function statusClass(status: StepStatus): string {
  if (status === "done") return "text-green-700 dark:text-green-400";
  if (status === "review") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export function RestaurantSetupChecklist({
  setupCounts,
  dataQuality,
  lang = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
}: {
  setupCounts: SetupCounts;
  dataQuality: DataQualityCounts;
  lang?: PreferredLanguage;
}) {
  const steps = deriveSteps(setupCounts, dataQuality, lang);
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
              {t(
                lang,
                "Set up your restaurant control tower",
                "Prepara el cockpit de tu restaurante"
              )}
            </CardTitle>
            {collapsed ? (
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  lang,
                  `${doneCount}/${steps.length} steps complete`,
                  `${doneCount}/${steps.length} pasos listos`
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                {t(
                  lang,
                  "Complete these steps to unlock recipe margins, supplier alerts, and Milton recommendations.",
                  "Completa estos pasos para ver márgenes, alertas de proveedores y recomendaciones de Milton."
                )}
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
                  ? t(
                      lang,
                      "Expand setup checklist",
                      "Mostrar la lista de configuración"
                    )
                  : t(
                      lang,
                      "Collapse setup checklist",
                      "Ocultar la lista de configuración"
                    )
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
                      {statusLabel(step.status, lang)}
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
                  {t(
                    lang,
                    "Ask Milton your first question",
                    "Hazle tu primera pregunta a Milton"
                  )}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(
                    lang,
                    "Explore insights, get recommendations, or ask about margins, suppliers, and trends.",
                    "Explora, pide recomendaciones o pregunta por márgenes, proveedores y tendencias."
                  )}
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
                {t(lang, "Ask Milton", "Preguntar a Milton")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
