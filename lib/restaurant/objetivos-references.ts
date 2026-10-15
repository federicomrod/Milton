// R1-16a: the "Referencia" column of Objetivos, from real data only. A figure
// that cannot be computed is null, and the screen shows a dash — never a
// made-up number.

import {
  dataSpanNote,
  indexByDate,
  trailingWindow,
  windowSales,
  addDays,
  type DayPoint,
} from "@/lib/restaurant/cockpit-math";
import { suggestWeekdayWeights } from "@/lib/restaurant/objetivos";

export interface ObjetivosReferences {
  /** The last day with sales (never later than today). */
  refDay: string | null;
  firstDay: string | null;
  /** Average month of sales over the last 6 months (cut to where the data starts). */
  avgMonthly6: number | null;
  /** "solo 3 meses de datos" when the 6 months are not all there. */
  span6Note: string | null;
  /** Net sales ÷ tickets, last 30 days. */
  ticket30: number | null;
  /** Milton's weekday split from the last 6 months. */
  suggestedWeights: number[] | null;
}

const MONTH_DAYS = 365.25 / 12;

export function objetivosReferences(
  daily: readonly DayPoint[],
  today: string
): ObjetivosReferences {
  const usable = daily.filter((d) => d.date <= today);
  if (usable.length === 0) {
    return {
      refDay: null,
      firstDay: null,
      avgMonthly6: null,
      span6Note: null,
      ticket30: null,
      suggestedWeights: null,
    };
  }
  const dates = usable.map((d) => d.date).sort();
  const firstDay = dates[0];
  const refDay = dates[dates.length - 1];
  const byDate = indexByDate(usable);
  const w6 = trailingWindow(refDay, 6, firstDay);
  const six = windowSales(byDate, w6.from, w6.to, firstDay);
  const thirty = windowSales(byDate, addDays(refDay, -29), refDay, firstDay);
  return {
    refDay,
    firstDay,
    avgMonthly6: six.avg === null ? null : six.avg * MONTH_DAYS,
    span6Note: dataSpanNote(w6),
    ticket30: thirty.tickets > 0 ? thirty.sales / thirty.tickets : null,
    suggestedWeights: suggestWeekdayWeights(
      usable.filter((d) => d.date >= w6.from && d.date <= w6.to)
    ),
  };
}
