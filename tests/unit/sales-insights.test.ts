import { describe, it, expect } from "vitest";
import {
  buildCockpitSalesAggregate,
  type CockpitFactRow,
  type HeatmapCell,
} from "@/lib/restaurant/cockpit-aggregates";
import { resolveCockpitPeriod } from "@/lib/restaurant/cockpit-period";
import {
  buildSalesInsights,
  DINNER_START_HOUR,
  enrichHeatmapCells,
  filterExplorerRowsForPeriod,
  filterRowsForSalesPeriod,
  findPeakSlot,
  findStrongestWeekday,
  findWeakestWeekday,
  flattenMixSeries,
  hourLabel,
  lunchVsDinner,
  MIN_DAYS_FOR_FINDINGS,
  MIN_PEAK_SLOT_OCCURRENCES,
  MIN_TICKETS_FOR_DAYPART_SHARE,
  MIN_WEEKDAY_OCCURRENCES,
  rankCategories,
  salesDayStatsFromRows,
  ticketCountLabel,
  weekdayLabel,
  type PeakSlot,
  type WeekdayStat,
} from "@/lib/restaurant/sales-insights";
import {
  bumpAskMiltonPrefill,
  parseSalesExploreTab,
  salesHref,
} from "@/lib/restaurant/sales-explore";
import { contractEs } from "@/lib/restaurant/cockpit-executive";

const ES = "America/El_Salvador";

function row(
  partial: Partial<CockpitFactRow> & Pick<CockpitFactRow, "sale_date">
): CockpitFactRow {
  return {
    raw_item_name: "Pupusa",
    quantity: 1,
    gross_revenue: 10,
    discount_amount: 0,
    check_id: "o1",
    currency: "USD",
    sales_channel: "in_store",
    payment_type: "card",
    category: "Mains",
    ...partial,
  };
}

function cell(
  weekday: number,
  hour: number,
  net_sales: number,
  tickets = 1
): HeatmapCell {
  const keys = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ] as const;
  return {
    weekday,
    weekday_key: keys[weekday],
    hour,
    net_sales,
    tickets,
  };
}

/** Mondays in July 2026: 6, 13, 20, 27. Fridays: 3, 10, 17, 24, 31. */
const JULY_MONDAYS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"];
const JULY_FRIDAYS = [
  "2026-07-03",
  "2026-07-10",
  "2026-07-17",
  "2026-07-24",
  "2026-07-31",
];

function mondayNoonUtc(date: string): string {
  return `${date}T18:00:00.000Z`;
}

function fridayEightPmUtc(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1, 2, 0, 0));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T02:00:00.000Z`;
}

function julyUnequalWeekdays(): CockpitFactRow[] {
  const mondays = JULY_MONDAYS.map((date, i) =>
    row({
      sale_date: date,
      order_placed_at: mondayNoonUtc(date),
      check_id: `mon-${i}`,
      gross_revenue: 1000,
    })
  );
  const fridays = JULY_FRIDAYS.map((date, i) =>
    row({
      sale_date: date,
      order_placed_at: fridayEightPmUtc(date),
      check_id: `fri-${i}`,
      gross_revenue: 900,
    })
  );
  return [...mondays, ...fridays];
}

describe("thresholds", () => {
  it("documents named occurrence and ticket floors", () => {
    expect(MIN_WEEKDAY_OCCURRENCES).toBe(2);
    expect(MIN_PEAK_SLOT_OCCURRENCES).toBe(2);
    expect(MIN_DAYS_FOR_FINDINGS).toBe(2);
    expect(MIN_TICKETS_FOR_DAYPART_SHARE).toBe(20);
    expect(DINNER_START_HOUR).toBe(17);
  });
});

describe("per-day averages beat raw totals (4 Mondays $1,000 vs 5 Fridays $900)", () => {
  const rows = julyUnequalWeekdays();
  const stats = salesDayStatsFromRows(rows, { timezone: ES, currency: "USD" });
  const agg = buildCockpitSalesAggregate(rows, {
    timezone: ES,
    currency: "USD",
  });
  const insights = buildSalesInsights(agg, "es", stats);

  it("ranks Monday strongest by average even though Friday has the bigger total", () => {
    const monday = stats.weekdays.find((w) => w.weekday === 1);
    const friday = stats.weekdays.find((w) => w.weekday === 5);
    expect(monday?.days).toBe(4);
    expect(monday?.avg_per_day).toBe(1000);
    expect(monday?.net_sales).toBe(4000);
    expect(friday?.days).toBe(5);
    expect(friday?.avg_per_day).toBe(900);
    expect(friday?.net_sales).toBe(4500);
    expect(findStrongestWeekday(stats.weekdays)?.weekday).toBe(1);
    expect(findWeakestWeekday(stats.weekdays)?.weekday).toBe(5);
    expect(insights.strongest_weekday?.weekday).toBe(1);
    expect(insights.highlights.some((h) => /lunes/.test(h.body))).toBe(true);
    expect(insights.highlights.some((h) => h.id === "strongest_weekday")).toBe(
      true
    );
    const strongest = insights.highlights.find(
      (h) => h.id === "strongest_weekday"
    );
    expect(strongest?.title).toBe("Día más fuerte");
    expect(strongest?.body).toContain("$1,000 por lunes");
    expect(strongest?.body).toContain("total de los 4 lunes: $4,000");
    expect(strongest?.ask_question).toContain("día más fuerte por promedio");
    expect(strongest?.ask_question).toContain("$1,000");
    expect(strongest?.ask_question).toContain("4 lunes");
  });

  it("picks the peak slot by average per weekday-hour, not raw total", () => {
    const peak = findPeakSlot(stats.slots);
    expect(peak?.weekday).toBe(1);
    expect(peak?.hour).toBe(12);
    expect(peak?.avg_per_day).toBe(1000);
    expect(peak?.days).toBe(4);
    expect(insights.peak_slot?.weekday).toBe(1);
    const slot = insights.highlights.find((h) => h.id === "peak_slot");
    expect(slot?.title).toBe("Franja más fuerte");
    expect(slot?.body).toContain("$1,000 por lunes a las 12:00");
    expect(slot?.body).toContain("total de las 4 veces: $4,000");
    expect(slot?.ask_question).toContain("franja más fuerte por promedio");
  });
});

describe("occurrence floors", () => {
  it("does not name a weekday or slot with fewer than 2 dates", () => {
    const rows = [
      row({
        sale_date: "2026-07-06",
        order_placed_at: mondayNoonUtc("2026-07-06"),
        check_id: "mon",
        gross_revenue: 1000,
      }),
      ...JULY_FRIDAYS.slice(0, 1).map((date) =>
        row({
          sale_date: date,
          order_placed_at: fridayEightPmUtc(date),
          check_id: "fri",
          gross_revenue: 900,
        })
      ),
    ];
    const stats = salesDayStatsFromRows(rows, {
      timezone: ES,
      currency: "USD",
    });
    expect(findStrongestWeekday(stats.weekdays)).toBeNull();
    expect(findPeakSlot(stats.slots)).toBeNull();
    const insights = buildSalesInsights(
      buildCockpitSalesAggregate(rows, { timezone: ES, currency: "USD" }),
      "es",
      stats
    );
    expect(insights.availability).toBe("ready");
    expect(insights.peak_slot).toBeNull();
    expect(insights.strongest_weekday).toBeNull();
    expect(insights.highlights.filter((h) => h.id !== "best_date")).toEqual([]);
  });
});

describe("empty and single-day states", () => {
  it("empty period uses Aún no disponible and no interpretation", () => {
    const agg = buildCockpitSalesAggregate([], {
      timezone: ES,
      currency: "USD",
    });
    const stats = salesDayStatsFromRows([], { timezone: ES, currency: "USD" });
    const insights = buildSalesInsights(agg, "es", stats);
    expect(insights.availability).toBe("empty");
    expect(insights.interpretation).toBeNull();
    expect(insights.interpretationFact).toBeNull();
    expect(insights.highlights).toEqual([]);
    expect(insights.daypart.available).toBe(false);
    expect(insights.daypart.winner).toBeNull();
    expect(insights.daypart.reason).toBe("No hay ventas en este periodo.");
    const daypart = insights.summaries.find((s) => s.id === "daypart");
    expect(daypart?.value).toBe("Aún no disponible");
    expect(daypart?.available).toBe(false);
    expect(daypart?.hint).toBe("No hay ventas en este periodo.");
    expect(insights.summaries.find((s) => s.id === "net_sales")?.value).toBe(
      "Aún no disponible"
    );
    expect(JSON.stringify(insights)).not.toContain("Empate");
    expect(JSON.stringify(insights)).not.toContain("$0.00 en 0 tickets");
  });

  it("one Friday sale is insufficient for findings and daypart share", () => {
    const rows = [
      row({
        sale_date: "2026-07-31",
        order_placed_at: fridayEightPmUtc("2026-07-31"),
        check_id: "fri",
        gross_revenue: 200,
      }),
    ];
    const agg = buildCockpitSalesAggregate(rows, {
      timezone: ES,
      currency: "USD",
    });
    const stats = salesDayStatsFromRows(rows, {
      timezone: ES,
      currency: "USD",
    });
    const insights = buildSalesInsights(agg, "es", stats);
    expect(stats.days_with_sales).toBe(1);
    expect(insights.availability).toBe("insufficient");
    expect(insights.peak_slot).toBeNull();
    expect(insights.strongest_weekday).toBeNull();
    expect(insights.highlights).toEqual([]);
    expect(insights.interpretation).toBeNull();
    expect(insights.daypart.available).toBe(false);
    expect(insights.daypart.lunch_share_pct).toBeNull();
    expect(insights.summaries.find((s) => s.id === "daypart")?.value).toBe(
      "Aún no disponible"
    );
    const blob = JSON.stringify(insights);
    expect(blob).not.toContain("Día más fuerte");
    expect(blob).not.toContain("la cena concentra el 100");
    expect(blob).not.toContain("El pico es el viernes");
  });
});

describe("singular / plural tickets", () => {
  it("uses 1 ticket and N tickets", () => {
    expect(ticketCountLabel(1, "es")).toBe("1 ticket");
    expect(ticketCountLabel(1, "en")).toBe("1 ticket");
    expect(ticketCountLabel(2, "es")).toBe("2 tickets");
    expect(ticketCountLabel(0, "es")).toBe("0 tickets");
  });
});

describe("Ask Milton prefill nonce", () => {
  it("bumps the nonce when the same question is sent again", () => {
    const first = bumpAskMiltonPrefill(0, "¿Por qué el lunes?");
    expect(first).toEqual({ draft: "¿Por qué el lunes?", nonce: 1 });
    const again = bumpAskMiltonPrefill(first.nonce, "¿Por qué el lunes?");
    expect(again.draft).toBe("¿Por qué el lunes?");
    expect(again.nonce).toBe(2);
    expect(bumpAskMiltonPrefill(2, "  ")).toEqual({ draft: null, nonce: 2 });
  });
});

describe("lunch vs dinner math still uses the 17:00 cutoff", () => {
  it("splits at the documented 17:00 cutoff and reports shares", () => {
    const split = lunchVsDinner([
      {
        daypart: "lunch",
        hours: "00:00–17:00",
        net_sales: 40,
        tickets: 2,
        avg_ticket: 20,
      },
      {
        daypart: "dinner",
        hours: "17:00–24:00",
        net_sales: 60,
        tickets: 2,
        avg_ticket: 30,
      },
    ]);
    expect(split.winner).toBe("dinner");
    expect(split.dinner_share_pct).toBe(60);
    expect(split.lunch_share_pct).toBe(40);
  });
});

describe("rankCategories / flatten / enrich", () => {
  it("keeps the top N and rolls the rest into other", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      category: `Cat ${i + 1}`,
      net_sales: 80 - i * 10,
      tickets: 8 - i,
      units: 8 - i,
    }));
    const ranked = rankCategories(rows, 6);
    expect(ranked.top.map((r) => r.category)).toEqual([
      "Cat 1",
      "Cat 2",
      "Cat 3",
      "Cat 4",
      "Cat 5",
      "Cat 6",
    ]);
    expect(ranked.other).toEqual({ net_sales: 30, tickets: 3, count: 2 });
  });

  it("sums mix series deterministically", () => {
    const mix = flattenMixSeries([
      { period: "2026-07-20", values: { in_store: 10, delivery: 4 } },
      { period: "2026-07-27", values: { in_store: 5, takeaway: 2 } },
    ]);
    expect(mix.map((m) => m.key)).toEqual(["in_store", "delivery", "takeaway"]);
    expect(mix[0].net_sales).toBe(15);
  });

  it("adds avg ticket and vs typical from the backend", () => {
    const enriched = enrichHeatmapCells([
      cell(5, 20, 40, 2),
      cell(4, 20, 20, 1),
    ]);
    const friday = enriched.find((c) => c.weekday === 5);
    expect(friday?.avg_ticket).toBe(20);
    expect(friday?.typical_net).toBe(30);
    expect(friday?.vs_typical_pct).toBe(33.3);
  });
});

describe("filterRowsForSalesPeriod / explorer", () => {
  it("keeps only the current cockpit window by local date", () => {
    const period = resolveCockpitPeriod("last_7", "2026-07-31");
    expect(period).not.toBeNull();
    const rows = [
      row({ sale_date: "2026-07-31", check_id: "in", gross_revenue: 10 }),
      row({ sale_date: "2026-07-20", check_id: "out", gross_revenue: 99 }),
    ];
    const filtered = filterRowsForSalesPeriod(rows, period!, ES);
    expect(filtered.map((r) => r.check_id)).toEqual(["in"]);
    expect(
      filterExplorerRowsForPeriod(
        [
          {
            id: "1",
            item_name: "Pupusa",
            quantity: 1,
            revenue: 10,
            order_key: "in",
            sales_channel: "in_store",
            payment_type: "card",
            category: "Mains",
            sub_category: null,
            sale_date: "2026-07-31",
            currency: "USD",
            is_tip: false,
            discount_amount: 0,
            discount_estimated: false,
          },
          {
            id: "2",
            item_name: "Old",
            quantity: 1,
            revenue: 99,
            order_key: "out",
            sales_channel: "in_store",
            payment_type: "card",
            category: "Mains",
            sub_category: null,
            sale_date: "2026-07-20",
            currency: "USD",
            is_tip: false,
            discount_amount: 0,
            discount_estimated: false,
          },
        ],
        period!
      ).map((r) => r.id)
    ).toEqual(["1"]);
  });
});

describe("buildSalesInsights — money, Spanish, no invented numbers", () => {
  const rows = julyUnequalWeekdays();
  rows.push(
    row({
      sale_date: "2026-07-31",
      check_id: "fri-4",
      raw_item_name: "Propina",
      gross_revenue: 20,
    })
  );
  const agg = buildCockpitSalesAggregate(rows, {
    timezone: ES,
    currency: "USD",
  });
  const stats = salesDayStatsFromRows(rows, { timezone: ES, currency: "USD" });

  it("excludes tips from net and keeps them on their own line", () => {
    expect(agg.revenue.net_sales).toBe(8500);
    expect(agg.revenue.tips).toBe(20);
    const insights = buildSalesInsights(agg, "es", stats);
    expect(insights.summaries[0].value).toBe("$8,500.00");
    expect(insights.summaries[0].value).not.toContain("USD");
    expect(insights.summaries[0].hint).toContain("$20.00");
  });

  it("is deterministic and Spanish-complete without de el / a el", () => {
    const a = buildSalesInsights(agg, "es", stats);
    const b = buildSalesInsights(agg, "es", stats);
    expect(a.peak_slot).toEqual(b.peak_slot);
    expect(a.strongest_weekday).toEqual(b.strongest_weekday);
    expect(a.interpretation?.body).toEqual(b.interpretation?.body);
    expect(a.highlights.map((h) => h.title)).toContain("Día más fuerte");
    expect(a.highlights.map((h) => h.title)).toContain("Franja más fuerte");
    expect(a.interpretation?.title).toBe("La lectura de Milton");
    expect(a.interpretation?.body).toMatch(/lunes/);
    expect(a.interpretation?.body).not.toMatch(/\bde el\b/);
    expect(a.interpretation?.body).not.toMatch(/\ba el\b/);
    expect(weekdayLabel(5, "es")).toBe("viernes");
    expect(hourLabel(20)).toBe("20:00");
    for (const highlight of a.highlights) {
      if (!highlight.ask_question) continue;
      expect(highlight.ask_question).toMatch(/¿/);
      expect(highlight.ask_question).not.toMatch(/\bde el\b/);
      expect(contractEs(highlight.ask_question)).toBe(highlight.ask_question);
    }
  });
});

describe("explore switcher + href helpers", () => {
  it("defaults to channels and accepts the three tabs", () => {
    expect(parseSalesExploreTab(null)).toBe("channels");
    expect(parseSalesExploreTab("categories")).toBe("categories");
    expect(parseSalesExploreTab("payments")).toBe("payments");
    expect(parseSalesExploreTab("nope")).toBe("channels");
  });

  it("keeps location and month period on detalle links", () => {
    expect(
      salesHref("/dashboard/restaurant/sales/detalle", {
        locationId: "loc-1",
        period: "month",
        hash: "categorias",
      })
    ).toBe(
      "/dashboard/restaurant/sales/detalle?location=loc-1&period=month#categorias"
    );
  });
});

describe("unused heatmap-total ranking helpers stay typed", () => {
  it("PeakSlot / WeekdayStat require days + avg_per_day", () => {
    const slot: PeakSlot = {
      weekday: 1,
      weekday_key: "Monday",
      hour: 12,
      net_sales: 2000,
      tickets: 2,
      days: 2,
      avg_per_day: 1000,
    };
    const weekday: WeekdayStat = {
      weekday: 1,
      weekday_key: "Monday",
      net_sales: 2000,
      tickets: 2,
      days: 2,
      avg_per_day: 1000,
    };
    expect(findPeakSlot([slot])?.avg_per_day).toBe(1000);
    expect(findStrongestWeekday([weekday])?.days).toBe(2);
  });
});
