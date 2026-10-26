// lib/restaurant/kitchen-insights.ts
//
// Deterministic Kitchen-page contract (#148). React only renders.
// Waste money is never estimated — "Pendiente de recetas" until #113.
// Recipe drafts are listed and marked as not counting in costs.

import {
  findExactIngredient,
  findSynonymIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { shiftDateKey } from "@/lib/restaurant/cockpit-aggregates";
import { polishCockpitCopy } from "@/lib/restaurant/cockpit-executive";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import {
  inInclusiveRange,
  type InclusiveDateRange,
} from "@/lib/restaurant/cockpit-period";
import { weekdayFromDateKey } from "@/lib/restaurant/pos-local-time";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  KITCHEN_EXPLORE_TOP_N,
  KITCHEN_FEED_PREVIEW,
  type KitchenExploreTab,
  type KitchenFeedFilter,
} from "@/lib/restaurant/kitchen-explore";

export const MAX_KITCHEN_HIGHLIGHTS = 3;
export const KITCHEN_PENDING_RECIPES_ES = "Pendiente de recetas";
export const KITCHEN_NOT_AVAILABLE_ES = "Aún no disponible";

export type KitchenReportType = "running_out" | "86" | "waste" | "unclassified";
export type KitchenFeedKind = "running_out" | "waste" | "drafts";

export interface KitchenReportEvent {
  id: string;
  location_id: string;
  staff_id: string;
  staff_name: string;
  report_type: KitchenReportType;
  text: string | null;
  media_kind: "photo" | "voice" | null;
  created_at: string;
  resolved_at: string | null;
  local_date: string;
  local_hour: number | null;
  local_minute: number | null;
}

export interface KitchenDraftEvent {
  id: string;
  dish_name: string;
  portions: number | null;
  status: "awaiting_portions" | "draft";
  staff_name: string;
  created_at: string;
  local_date: string;
  local_hour: number | null;
  local_minute: number | null;
  has_photo: boolean;
}

export interface KitchenStaffRow {
  id: string;
  display_name: string;
  is_active: boolean;
}

export interface KitchenEventBundle {
  reports: KitchenReportEvent[];
  drafts: KitchenDraftEvent[];
  staff: KitchenStaffRow[];
  /** The company's ACTIVE ingredients: a report about one shows ITS name. */
  ingredients?: Array<{ id: string; name: string }>;
}

export interface KitchenFeedItem {
  id: string;
  kind: KitchenFeedKind;
  title: string;
  detail: string;
  time_label: string;
  action: "resolve" | "view_reports" | "review";
  action_label: string;
  report_ids: string[];
  draft_id: string | null;
  latest_at: string;
}

export type KitchenHighlightId = "most_reported" | "peak_hour" | "staff_active";

export interface KitchenHighlight {
  id: KitchenHighlightId;
  title: string;
  value: string;
  hint: string;
  facts: Record<string, number | string | null>;
}

export interface KitchenSummary {
  id: KitchenFeedKind;
  label: string;
  value: string;
  hint: string;
  extra: string | null;
  pending_value: boolean;
  explore_tab: KitchenExploreTab;
  segments: number[];
}

export interface KitchenExploreRow {
  key: string;
  rank: number;
  label: string;
  count: number;
  bar_pct: number;
  last_label: string;
  estimated_value: string | null;
  pending_value: boolean;
}

export interface KitchenStaffExploreRow {
  id: string;
  name: string;
  reports: number;
  last_label: string | null;
  is_active: boolean;
}

export interface KitchenInsights {
  availability: "empty" | "ready";
  headline: string;
  today_running_out: number;
  today_waste: number;
  pending_drafts: number;
  feed: KitchenFeedItem[];
  feed_total: number;
  counts: {
    all: number;
    running_out: number;
    waste: number;
    drafts: number;
  };
  highlights: KitchenHighlight[];
  summaries: KitchenSummary[];
  explore: {
    running_out: KitchenExploreRow[];
    waste: KitchenExploreRow[];
    drafts: KitchenExploreRow[];
    staff: KitchenStaffExploreRow[];
    history: KitchenExploreRow[];
    waste_total_products: number;
  };
  period_ask_question: string;
  pending_recipes_label: string;
  empty_feed: string;
  insightFacts: CockpitInsightFact[];
}

const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const ITEM_PREFIX_RE =
  /^(?:se est[aá] (?:agotando|acabando)|queda(?:n)? poco(?:s)?(?: de)?|casi no (?:hay|queda)|merma(?: alta)?(?: de|:)?|86|se acab[oó](?:ron)?(?: el| la| los| las)?|no hay|nos quedamos sin|sin|agotad[oa]s?(?: de|:)?)\s+/i;
const ITEM_SUFFIX_RE =
  /\s+(?:queda(?:n)? poco(?:s)?|se est[aá] (?:agotando|acabando)|tiramos|tirado|se quem[oó]|se pas[oó]|(?:y\s+)?(?:ahora|ya)\b|(?:y\s+)?(?:est[aá]|cuesta|sale|vale)\s+(?:a|en)\b|a\s+(?:un|una|\$|\d)).*$/i;

/** «1 producto», «2 productos», «0 productos». */
export function countText(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function foldKitchenText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Product name from cook text. Never invents — leftover text or the raw line. */
export function extractKitchenItemName(
  text: string | null | undefined
): string {
  if (!text || !text.trim()) return "";
  const first = text.trim().split(/[\n.]/)[0]?.trim() ?? "";
  if (!first) return "";
  const stripped = first
    .replace(ITEM_PREFIX_RE, "")
    .replace(ITEM_SUFFIX_RE, "")
    .replace(/^[·:\-–]\s*/, "")
    .replace(/^(el|la|los|las)\s+/i, "")
    .trim();
  const name = stripped || first;
  return name.slice(0, 48);
}

export function kitchenItemKey(text: string | null | undefined): string {
  const name = extractKitchenItemName(text);
  return foldKitchenText(name || text || "");
}

export function pendingRecipesLabel(lang: PreferredLanguage): string {
  return t(lang, "Pending recipes", KITCHEN_PENDING_RECIPES_ES);
}

export function notAvailableYetLabel(lang: PreferredLanguage): string {
  return t(lang, "Not available yet", KITCHEN_NOT_AVAILABLE_ES);
}

export function isLowStockType(type: KitchenReportType): boolean {
  return type === "running_out" || type === "86";
}

export function filterReportsForRange(
  reports: KitchenReportEvent[],
  range: InclusiveDateRange
): KitchenReportEvent[] {
  return reports.filter(
    (row) => row.local_date && inInclusiveRange(row.local_date, range)
  );
}

export function openLowStockReports(
  reports: KitchenReportEvent[]
): KitchenReportEvent[] {
  return reports.filter(
    (row) => isLowStockType(row.report_type) && !row.resolved_at
  );
}

function pad2(n: number): string {
  return String(Math.min(59, Math.max(0, Math.trunc(n)))).padStart(2, "0");
}

export function hourRangeLabel(hour: number): string {
  const h = Math.min(23, Math.max(0, Math.trunc(hour)));
  return `${pad2(h)}:00–${pad2((h + 1) % 24)}:00`;
}

export function formatKitchenClock(
  hour: number | null,
  minute: number | null
): string {
  if (hour == null || !Number.isFinite(hour)) return "";
  return `${pad2(hour)}:${pad2(minute ?? 0)}`;
}

export function kitchenRelativeTime(
  event: {
    local_date: string;
    local_hour: number | null;
    local_minute: number | null;
  },
  todayKey: string,
  lang: PreferredLanguage
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.local_date)) return "";
  const clock = formatKitchenClock(event.local_hour, event.local_minute);
  if (event.local_date === todayKey) return clock || t(lang, "Today", "Hoy");
  const yesterday = shiftDateKey(todayKey, -1);
  if (event.local_date === yesterday) {
    return clock
      ? t(lang, `Yesterday ${clock}`, `Ayer ${clock}`)
      : t(lang, "Yesterday", "Ayer");
  }
  const weekday = weekdayFromDateKey(event.local_date);
  const short =
    lang === "es" ? WEEKDAY_SHORT_ES[weekday] : WEEKDAY_SHORT_EN[weekday];
  return clock ? `${short} ${clock}` : short;
}

function sortLatest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.created_at === b.created_at) return a === b ? 0 : 0;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

function latestOf<T extends { created_at: string }>(rows: T[]): T | null {
  return sortLatest(rows)[0] ?? null;
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row) || "__unknown__";
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * What a report is ABOUT, for the lists: the matched ingredient's name when the
 * product is one of the company's ingredients; else the product name pulled
 * from the sentence; only when neither exists, the raw text (truncated).
 */
export function resolveKitchenItemLabel(
  text: string | null | undefined,
  ingredients?: ReadonlyArray<{ id: string; name: string }>
): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  const name = extractKitchenItemName(raw);
  if (name && ingredients && ingredients.length > 0) {
    const hit =
      findExactIngredient(name, ingredients) ??
      findSynonymIngredient(name, ingredients);
    if (hit) return hit.name;
  }
  return name || raw.slice(0, 48);
}

function displayNameFromReports(
  rows: KitchenReportEvent[],
  ingredients?: ReadonlyArray<{ id: string; name: string }>
): string {
  for (const row of rows) {
    const label = resolveKitchenItemLabel(row.text, ingredients);
    if (label) return label;
  }
  return "";
}

function staffPhrase(
  rows: KitchenReportEvent[],
  lang: PreferredLanguage
): string {
  const names = Array.from(
    new Set(rows.map((row) => row.staff_name.trim()).filter(Boolean))
  );
  if (rows.length === 1 && names[0]) {
    return t(lang, `reported by ${names[0]}`, `reportado por ${names[0]}`);
  }
  return t(
    lang,
    countText(rows.length, "report", "reports"),
    countText(rows.length, "reporte", "reportes")
  );
}

function buildFeed(input: {
  ingredients?: KitchenEventBundle["ingredients"];
  openLowStock: KitchenReportEvent[];
  periodWaste: KitchenReportEvent[];
  drafts: KitchenDraftEvent[];
  todayKey: string;
  lang: PreferredLanguage;
}): KitchenFeedItem[] {
  const { openLowStock, periodWaste, drafts, todayKey, lang, ingredients } =
    input;
  const items: KitchenFeedItem[] = [];

  for (const [key, rows] of groupBy(openLowStock, (row) =>
    kitchenItemKey(row.text)
  )) {
    const latest = latestOf(rows);
    if (!latest) continue;
    const title =
      displayNameFromReports(rows, ingredients) || t(lang, "Item", "Producto");
    items.push({
      id: `running_out:${key}`,
      kind: "running_out",
      title,
      detail: polishCockpitCopy(
        lang,
        t(
          lang,
          `Running low · ${staffPhrase(rows, lang)}`,
          `Se está agotando · ${staffPhrase(rows, lang)}`
        )
      ),
      time_label: kitchenRelativeTime(latest, todayKey, lang),
      action: "resolve",
      action_label: t(lang, "Mark resolved", "Marcar resuelto"),
      report_ids: rows.map((row) => row.id),
      draft_id: null,
      latest_at: latest.created_at,
    });
  }

  for (const [key, rows] of groupBy(periodWaste, (row) =>
    kitchenItemKey(row.text)
  )) {
    const latest = latestOf(rows);
    if (!latest) continue;
    const title =
      displayNameFromReports(rows, ingredients) || t(lang, "Waste", "Merma");
    const weekish = rows.length >= 2;
    items.push({
      id: `waste:${key}`,
      kind: "waste",
      title,
      detail: polishCockpitCopy(
        lang,
        weekish
          ? t(
              lang,
              `High waste · ${rows.length} reports this week`,
              `Merma alta · ${rows.length} reportes esta semana`
            )
          : t(lang, "Waste reported", "Merma reportada")
      ),
      time_label: kitchenRelativeTime(latest, todayKey, lang),
      action: "view_reports",
      action_label: t(lang, "View reports", "Ver reportes"),
      report_ids: rows.map((row) => row.id),
      draft_id: null,
      latest_at: latest.created_at,
    });
  }

  for (const draft of drafts) {
    const dish = draft.dish_name.trim() || t(lang, "Recipe", "Receta");
    const photo = draft.has_photo ? t(lang, "photo", "foto") : null;
    const portions =
      draft.portions && draft.portions > 0
        ? t(lang, `${draft.portions} portions`, `${draft.portions} porciones`)
        : t(lang, "portions pending", "faltan las porciones");
    const bits = [photo, portions].filter(Boolean).join(" + ");
    items.push({
      id: `draft:${draft.id}`,
      kind: "drafts",
      title: t(lang, `Recipe: ${dish}`, `Receta: ${dish}`),
      detail: polishCockpitCopy(
        lang,
        t(
          lang,
          `Cook draft: ${bits} · waiting for your confirmation`,
          `Borrador del cocinero: ${bits} · falta tu confirmación`
        )
      ),
      time_label: kitchenRelativeTime(draft, todayKey, lang),
      action: "review",
      action_label: t(lang, "Review", "Revisar"),
      report_ids: [],
      draft_id: draft.id,
      latest_at: draft.created_at,
    });
  }

  return items.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
}

function rankedFromGroups(
  groups: Map<string, KitchenReportEvent[]>,
  todayKey: string,
  lang: PreferredLanguage,
  pendingLabel: string,
  ingredients?: KitchenEventBundle["ingredients"]
): KitchenExploreRow[] {
  const rows = Array.from(groups.entries())
    .map(([key, list]) => {
      const latest = latestOf(list);
      return {
        key,
        label:
          displayNameFromReports(list, ingredients) ||
          t(lang, "Item", "Producto"),
        count: list.length,
        last_label: latest ? kitchenRelativeTime(latest, todayKey, lang) : "",
        latest_at: latest?.created_at ?? "",
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, lang === "es" ? "es" : "en");
    });
  const max = rows[0]?.count ?? 0;
  return rows.map((row, i) => ({
    key: row.key,
    rank: i + 1,
    label: row.label,
    count: row.count,
    bar_pct: max > 0 ? Math.round((row.count / max) * 1000) / 10 : 0,
    last_label: row.last_label,
    estimated_value: pendingLabel,
    pending_value: true,
  }));
}

function namesHint(names: string[], lang: PreferredLanguage): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]}, ${clean[1]}`;
  return t(
    lang,
    `${clean[0]}, ${clean[1]} and ${clean.length - 2} more`,
    `${clean[0]}, ${clean[1]} y ${clean.length - 2} más`
  );
}

function buildHighlights(input: {
  periodReports: KitchenReportEvent[];
  todayReports: KitchenReportEvent[];
  staff: KitchenStaffRow[];
  todayKey: string;
  lang: PreferredLanguage;
}): { highlights: KitchenHighlight[]; insightFacts: CockpitInsightFact[] } {
  const { periodReports, todayReports, staff, lang } = input;
  const highlights: KitchenHighlight[] = [];
  const insightFacts: CockpitInsightFact[] = [];

  const classified = periodReports.filter(
    (row) => row.report_type !== "unclassified"
  );
  const byItem = groupBy(classified, (row) => kitchenItemKey(row.text));
  let topKey = "";
  let topRows: KitchenReportEvent[] = [];
  for (const [key, rows] of byItem) {
    if (rows.length > topRows.length) {
      topKey = key;
      topRows = rows;
    }
  }
  if (topRows.length > 0) {
    const name = displayNameFromReports(topRows) || t(lang, "Item", "Producto");
    const waste = topRows.filter((row) => row.report_type === "waste").length;
    const value =
      waste > 0 && waste === topRows.length
        ? t(
            lang,
            `${name} · ${countText(topRows.length, "waste report", "waste reports")}`,
            `${name} · ${countText(topRows.length, "reporte de merma", "reportes de merma")}`
          )
        : t(
            lang,
            `${name} · ${countText(topRows.length, "report", "reports")}`,
            `${name} · ${countText(topRows.length, "reporte", "reportes")}`
          );
    const title = t(lang, "Most reported", "Más reportado");
    const hint = t(
      lang,
      "It is the item with the most reports this week",
      "Es el producto con más reportes esta semana"
    );
    highlights.push({
      id: "most_reported",
      title,
      value: polishCockpitCopy(lang, value),
      hint: polishCockpitCopy(lang, hint),
      facts: {
        item: name,
        reports: topRows.length,
        waste_reports: waste,
        item_key: topKey,
      },
    });
    insightFacts.push({
      id: "kitchen_most_reported",
      kind: "kitchen_most_reported",
      score: 1,
      facts: { item: name, reports: topRows.length, waste_reports: waste },
      title,
      body: polishCockpitCopy(lang, `${value}. ${hint}`),
    });
  }

  const hourBuckets = new Map<number, number>();
  for (const row of todayReports) {
    if (row.local_hour == null) continue;
    hourBuckets.set(row.local_hour, (hourBuckets.get(row.local_hour) ?? 0) + 1);
  }
  let peakHour: number | null = null;
  let peakCount = 0;
  for (const [hour, count] of hourBuckets) {
    if (
      count > peakCount ||
      (count === peakCount && peakHour != null && hour < peakHour)
    ) {
      peakHour = hour;
      peakCount = count;
    }
  }
  if (peakHour != null && peakCount > 0 && todayReports.length > 0) {
    const range = hourRangeLabel(peakHour);
    const meal =
      peakHour < 12
        ? t(lang, "before lunch", "antes del almuerzo")
        : peakHour < 17
          ? t(lang, "around lunch", "alrededor del almuerzo")
          : t(lang, "in the evening", "por la noche");
    const title = t(
      lang,
      "Hour with the most reports",
      "Hora con más reportes"
    );
    const value = `${range}, ${meal}`;
    const hint = t(
      lang,
      `${peakCount} of ${countText(todayReports.length, "report", "reports")} today arrived in that hour`,
      `${peakCount} de ${countText(todayReports.length, "reporte", "reportes")} de hoy ${peakCount === 1 ? "llegó" : "llegaron"} en esa hora`
    );
    highlights.push({
      id: "peak_hour",
      title,
      value: polishCockpitCopy(lang, value),
      hint: polishCockpitCopy(lang, hint),
      facts: {
        hour: peakHour,
        hour_reports: peakCount,
        today_reports: todayReports.length,
      },
    });
    insightFacts.push({
      id: "kitchen_peak_hour",
      kind: "kitchen_peak_hour",
      score: 1,
      facts: {
        hour: peakHour,
        hour_reports: peakCount,
        today_reports: todayReports.length,
      },
      title,
      body: polishCockpitCopy(lang, `${value}. ${hint}`),
    });
  }

  const active = staff.filter((row) => row.is_active);
  const reporterIds = new Set(classified.map((row) => row.staff_id));
  const reporters = active.filter((row) => reporterIds.has(row.id)).length;
  if (active.length > 0 && classified.length > 0) {
    const title = t(lang, "Active team", "Equipo activo");
    const value = t(
      lang,
      `${reporters} of ${countText(active.length, "cook", "cooks")} reported`,
      `${reporters} de ${countText(active.length, "cocinero", "cocineros")} ${reporters === 1 ? "reportó" : "reportaron"}`
    );
    const hint = t(
      lang,
      `This week · ${countText(classified.length, "report", "reports")} in total`,
      `Esta semana · ${countText(classified.length, "reporte", "reportes")} en total`
    );
    highlights.push({
      id: "staff_active",
      title,
      value: polishCockpitCopy(lang, value),
      hint: polishCockpitCopy(lang, hint),
      facts: {
        reporters,
        active_cooks: active.length,
        reports: classified.length,
      },
    });
    insightFacts.push({
      id: "kitchen_staff_active",
      kind: "kitchen_staff_active",
      score: 1,
      facts: {
        reporters,
        active_cooks: active.length,
        reports: classified.length,
      },
      title,
      body: polishCockpitCopy(lang, `${value}. ${hint}`),
    });
  }

  return {
    highlights: highlights.slice(0, MAX_KITCHEN_HIGHLIGHTS),
    insightFacts: insightFacts.slice(0, MAX_KITCHEN_HIGHLIGHTS),
  };
}

export function filterFeed(
  feed: KitchenFeedItem[],
  filter: KitchenFeedFilter
): KitchenFeedItem[] {
  if (filter === "all") return feed;
  return feed.filter((item) => item.kind === filter);
}

export function buildKitchenInsights(
  bundle: KitchenEventBundle,
  lang: PreferredLanguage,
  options: {
    period: InclusiveDateRange;
    todayKey: string;
    periodLabel?: string | null;
  }
): KitchenInsights {
  const pending = pendingRecipesLabel(lang);
  const todayKey = options.todayKey;
  const periodReports = filterReportsForRange(bundle.reports, options.period);
  const todayReports = periodReports.filter(
    (row) => row.local_date === todayKey
  );
  const openLowStock = openLowStockReports(bundle.reports);
  const periodWaste = periodReports.filter(
    (row) => row.report_type === "waste"
  );
  const todayWaste = todayReports.filter((row) => row.report_type === "waste");
  const drafts = bundle.drafts.filter(
    (row) => row.status === "draft" || row.status === "awaiting_portions"
  );

  const feed = buildFeed({
    ingredients: bundle.ingredients,
    openLowStock,
    periodWaste,
    drafts,
    todayKey,
    lang,
  });

  const runningOutProducts = groupBy(openLowStock, (row) =>
    kitchenItemKey(row.text)
  );
  const wasteGroups = groupBy(periodWaste, (row) => kitchenItemKey(row.text));
  const todayRunningOut = runningOutProducts.size;
  const pendingDrafts = drafts.length;

  const headline = polishCockpitCopy(
    lang,
    t(
      lang,
      `${todayRunningOut} ${todayRunningOut === 1 ? "item running low" : "items running low"} · ${todayWaste.length} ${todayWaste.length === 1 ? "waste report" : "waste reports"} · ${pendingDrafts} ${pendingDrafts === 1 ? "recipe draft to review" : "recipe drafts to review"}`,
      `${todayRunningOut} ${todayRunningOut === 1 ? "producto por agotarse" : "productos por agotarse"} · ${todayWaste.length} ${todayWaste.length === 1 ? "reporte de merma" : "reportes de merma"} · ${pendingDrafts} ${pendingDrafts === 1 ? "borrador de receta por revisar" : "borradores de receta por revisar"}`
    )
  );

  const { highlights, insightFacts } = buildHighlights({
    periodReports,
    todayReports,
    staff: bundle.staff,
    todayKey,
    lang,
  });

  const runningOutNames = Array.from(runningOutProducts.values()).map((rows) =>
    displayNameFromReports(rows, bundle.ingredients)
  );
  const topWasteName = rankedFromGroups(
    wasteGroups,
    todayKey,
    lang,
    pending,
    bundle.ingredients
  )[0]?.label;

  const summaries: KitchenSummary[] = [
    {
      id: "running_out",
      label: t(lang, "Running low", "Se agota"),
      value: t(
        lang,
        countText(todayRunningOut, "item", "items"),
        countText(todayRunningOut, "producto", "productos")
      ),
      hint: namesHint(runningOutNames, lang),
      extra: null,
      pending_value: false,
      explore_tab: "running_out",
      segments: Array.from({ length: Math.min(todayRunningOut, 3) }, () =>
        todayRunningOut > 0 ? Math.round(100 / Math.min(todayRunningOut, 3)) : 0
      ),
    },
    {
      id: "waste",
      label: t(lang, "Waste", "Merma"),
      value: t(
        lang,
        `${countText(todayWaste.length, "report", "reports")} today`,
        `${countText(todayWaste.length, "reporte", "reportes")} hoy`
      ),
      hint: polishCockpitCopy(
        lang,
        topWasteName
          ? t(
              lang,
              `${periodWaste.length} in the period · ${topWasteName} the most frequent`,
              `${periodWaste.length} en el periodo · ${topWasteName} el más frecuente`
            )
          : t(
              lang,
              `${periodWaste.length} in the period`,
              `${periodWaste.length} en el periodo`
            )
      ),
      extra: t(lang, "Waste value:", "Valor de la merma:"),
      pending_value: true,
      explore_tab: "waste",
      segments:
        periodWaste.length > 0
          ? [Math.round((todayWaste.length / periodWaste.length) * 100)]
          : [],
    },
    {
      id: "drafts",
      label: t(lang, "Recipe drafts", "Recetas en borrador"),
      value: t(
        lang,
        `${pendingDrafts} to confirm`,
        `${pendingDrafts} por confirmar`
      ),
      hint: t(
        lang,
        "Nothing counts in costs until you confirm them",
        "Nada cuenta en costos hasta que las confirmes"
      ),
      extra: null,
      pending_value: false,
      explore_tab: "drafts",
      segments: pendingDrafts > 0 ? [100] : [],
    },
  ];

  const exploreRunningOut = rankedFromGroups(
    runningOutProducts,
    todayKey,
    lang,
    pending,
    bundle.ingredients
  ).map((row) => ({ ...row, pending_value: false, estimated_value: null }));
  const exploreWaste = rankedFromGroups(
    wasteGroups,
    todayKey,
    lang,
    pending,
    bundle.ingredients
  );
  const exploreDrafts: KitchenExploreRow[] = sortLatest(drafts).map(
    (draft, i) => ({
      key: draft.id,
      rank: i + 1,
      label: draft.dish_name.trim() || t(lang, "Recipe", "Receta"),
      count: 1,
      bar_pct: 100,
      last_label: kitchenRelativeTime(draft, todayKey, lang),
      estimated_value: null,
      pending_value: false,
    })
  );

  const reportsByStaff = groupBy(periodReports, (row) => row.staff_id);
  const staffRows: KitchenStaffExploreRow[] = bundle.staff
    .map((person) => {
      const rows = reportsByStaff.get(person.id) ?? [];
      const latest = latestOf(rows);
      return {
        id: person.id,
        name: person.display_name,
        reports: rows.length,
        last_label: latest ? kitchenRelativeTime(latest, todayKey, lang) : null,
        is_active: person.is_active,
      };
    })
    .sort((a, b) => {
      if (b.reports !== a.reports) return b.reports - a.reports;
      return a.name.localeCompare(b.name, lang === "es" ? "es" : "en");
    });

  const history = sortLatest(periodReports).map((row, i) => ({
    key: row.id,
    rank: i + 1,
    label:
      displayNameFromReports([row], bundle.ingredients) ||
      row.text?.trim().slice(0, 48) ||
      t(lang, "Report", "Reporte"),
    count: 1,
    bar_pct: 0,
    last_label: kitchenRelativeTime(row, todayKey, lang),
    estimated_value: row.report_type === "waste" ? pending : null,
    pending_value: row.report_type === "waste",
  }));

  const range = options.periodLabel?.trim() || null;
  const period_ask_question = polishCockpitCopy(
    lang,
    range
      ? t(
          lang,
          `What needs attention in the kitchen for ${range}?`,
          `¿Qué necesita atención en la cocina de ${range}?`
        )
      : t(
          lang,
          "What needs attention in the kitchen right now?",
          "¿Qué necesita atención en la cocina ahora?"
        )
  );

  const empty_feed = t(
    lang,
    "Nothing needs attention in the kitchen right now.",
    "Nada necesita atención en la cocina ahora."
  );

  return {
    availability: feed.length === 0 ? "empty" : "ready",
    headline,
    today_running_out: todayRunningOut,
    today_waste: todayWaste.length,
    pending_drafts: pendingDrafts,
    feed,
    feed_total: feed.length,
    counts: {
      all: feed.length,
      running_out: feed.filter((item) => item.kind === "running_out").length,
      waste: feed.filter((item) => item.kind === "waste").length,
      drafts: feed.filter((item) => item.kind === "drafts").length,
    },
    highlights,
    summaries,
    explore: {
      running_out: exploreRunningOut,
      waste: exploreWaste,
      drafts: exploreDrafts,
      staff: staffRows,
      history,
      waste_total_products: exploreWaste.length,
    },
    period_ask_question,
    pending_recipes_label: pending,
    empty_feed,
    insightFacts,
  };
}

export function kitchenExploreCaption(
  tab: KitchenExploreTab,
  insights: KitchenInsights,
  lang: PreferredLanguage
): string {
  if (tab === "waste") {
    const shown = Math.min(
      KITCHEN_EXPLORE_TOP_N,
      insights.explore.waste.length
    );
    return t(
      lang,
      `Top ${shown} of ${countText(insights.explore.waste_total_products, "item", "items")} with waste · this period`,
      `Top ${shown} de ${countText(insights.explore.waste_total_products, "producto", "productos")} con merma · este periodo`
    );
  }
  if (tab === "running_out") {
    return t(
      lang,
      `${countText(insights.today_running_out, "item", "items")} running low`,
      countText(
        insights.today_running_out,
        "producto por agotarse",
        "productos por agotarse"
      )
    );
  }
  if (tab === "drafts") {
    return t(
      lang,
      `${countText(insights.pending_drafts, "draft", "drafts")} waiting for confirmation · they do not count in costs yet`,
      `${countText(insights.pending_drafts, "borrador", "borradores")} por confirmar · ${insights.pending_drafts === 1 ? "aún no cuenta" : "aún no cuentan"} en costos`
    );
  }
  if (tab === "staff") {
    const active = insights.explore.staff.filter((row) => row.is_active).length;
    return t(
      lang,
      countText(active, "active cook", "active cooks"),
      countText(active, "cocinero activo", "cocineros activos")
    );
  }
  return t(lang, "Reports in this period", "Reportes de este periodo");
}

export { KITCHEN_FEED_PREVIEW };
