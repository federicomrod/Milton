// R1-17a: the business day and the shifts (mirror of migration 054). Synthetic.
import { describe, expect, it } from "vitest";
import {
  assignShift,
  buildBusinessDayConfig,
  businessMoment,
  cutoffFor,
  cutoffMinutes,
  NO_BUSINESS_DAY,
  validateShifts,
  type Shift,
} from "@/lib/restaurant/business-day";

const TZ = "America/El_Salvador"; // UTC-6, no DST
const at = (local: string) =>
  new Date(local.replace(" ", "T") + ":00-06:00").toISOString();
const ALL = [1, 2, 3, 4, 5, 6, 7];
const sh = (
  name: string,
  s: string,
  e: string,
  over: Partial<Shift> = {}
): Shift => ({
  name,
  start_time: s,
  end_time: e,
  weekdays: ALL,
  active: true,
  ...over,
});
const seeded = [
  sh("Almuerzo", "00:00", "17:00", { sort_order: 1 }),
  sh("Cena", "17:00", "24:00", { sort_order: 2 }),
];
const late = [
  sh("Almuerzo", "11:00", "17:00", { sort_order: 1 }),
  sh("Cena", "18:00", "02:00", { sort_order: 2 }),
];

describe("cutoff", () => {
  it("is 04:00 unless a shift crosses midnight; then the end of the last one", () => {
    expect(cutoffMinutes([])).toBe(240);
    expect(cutoffMinutes(seeded)).toBe(240); // 17:00–24:00 ends at midnight, it does not cross it
    expect(cutoffMinutes(late)).toBe(120);
    expect(
      cutoffMinutes([
        ...late,
        sh("Madrugada", "22:00", "03:30", { active: false }),
      ])
    ).toBe(120);
    expect(cutoffMinutes([sh("Raro", "20:00", "11:00")])).toBe(240); // later than 09:00 = unclear
  });
  it("before migration 054 there is no cutoff at all (today's calendar day)", () => {
    expect(cutoffFor(NO_BUSINESS_DAY, "L1")).toBe(0);
    const cfg = buildBusinessDayConfig(
      late.map((s) => ({ ...s, restaurant_id: "L2" })),
      ["L1", "L2"]
    );
    expect(cutoffFor(cfg, "L1")).toBe(240);
    expect(cutoffFor(cfg, "L2")).toBe(120);
    expect(cutoffFor(cfg, null)).toBe(240);
  });
});

describe("business moment (the same numbers as the SQL test)", () => {
  const m = (local: string, cutoff: number, date = local.slice(0, 10)) =>
    businessMoment({ sale_date: date, order_placed_at: at(local) }, TZ, cutoff);
  it("01:30 belongs to the previous day; the clock hour stays real; the weekday is the business one", () => {
    const x = m("2026-07-04 01:30", 240);
    expect(x).toMatchObject({
      date: "2026-07-03",
      hour: 1,
      clockMinutes: 90,
      isoWeekday: 5,
      weekday: 5,
    });
    expect(m("2026-07-04 04:30", 240)).toMatchObject({
      date: "2026-07-04",
      isoWeekday: 6,
    });
    expect(m("2026-07-04 02:30", 120)).toMatchObject({ date: "2026-07-04" });
    expect(m("2026-07-04 01:30", 120)).toMatchObject({ date: "2026-07-03" });
    expect(m("2026-07-05 00:10", 240)).toMatchObject({
      date: "2026-07-04",
      isoWeekday: 6,
    });
    expect(m("2026-07-05 00:10", 0)).toMatchObject({
      date: "2026-07-05",
      isoWeekday: 7,
      weekday: 0,
    });
  });
  it("a line with no timestamp keeps its date", () => {
    expect(
      businessMoment(
        { sale_date: "2026-07-05", order_placed_at: null },
        TZ,
        240
      )
    ).toMatchObject({
      date: "2026-07-05",
      hour: null,
      clockMinutes: null,
    });
  });
  it("crosses a month and a year", () => {
    expect(m("2026-08-01 02:00", 240)).toMatchObject({ date: "2026-07-31" });
    expect(m("2027-01-01 01:00", 240)).toMatchObject({ date: "2026-12-31" });
  });
});

describe("shift assignment", () => {
  const who = (list: Shift[], local: string, cutoff: number) => {
    const b = businessMoment(
      { sale_date: local.slice(0, 10), order_placed_at: at(local) },
      TZ,
      cutoff
    );
    return (
      assignShift(list, b.clockMinutes, b.isoWeekday)?.name ?? "Otro horario"
    );
  };
  it("T1: the seeded split is the old hour < 17 split", () => {
    expect(who(seeded, "2026-07-03 12:30", 240)).toBe("Almuerzo");
    expect(who(seeded, "2026-07-04 01:30", 240)).toBe("Almuerzo");
    expect(who(seeded, "2026-07-03 19:00", 240)).toBe("Cena");
    expect(who(seeded, "2026-07-03 23:59", 240)).toBe("Cena");
  });
  it("T3: Cena 18:00–02:00 holds a 01:30 order; 02:30 and 17:30 are Otro horario", () => {
    expect(who(late, "2026-07-04 01:30", 120)).toBe("Cena");
    expect(who(late, "2026-07-04 02:30", 120)).toBe("Otro horario");
    expect(who(late, "2026-07-03 17:30", 120)).toBe("Otro horario");
  });
  it("weekdays are the BUSINESS weekday: a Friday-only Cena holds Saturday 01:00", () => {
    const fri = [sh("Cena", "18:00", "02:00", { weekdays: [5] })];
    expect(who(fri, "2026-07-04 01:00", 120)).toBe("Cena"); // Sat 01:00 = Friday's business day
    expect(who(fri, "2026-07-04 19:00", 120)).toBe("Otro horario"); // Saturday evening
  });
  it("an inactive shift holds nothing", () => {
    expect(
      who(
        [sh("A", "00:00", "24:00", { active: false })],
        "2026-07-03 12:00",
        240
      )
    ).toBe("Otro horario");
  });
});

describe("validation (T4)", () => {
  it("rejects overlaps with the Spanish message, also across midnight", () => {
    const r = validateShifts([
      sh("Almuerzo", "11:00", "17:00"),
      sh("Cena", "16:00", "23:00"),
    ]);
    expect(r).toEqual({
      ok: false,
      message:
        "Los turnos «Almuerzo» y «Cena» se solapan el mismo día. Ajusta las horas.",
    });
    expect(
      validateShifts([sh("A", "00:00", "17:00"), sh("B", "18:00", "02:00")]).ok
    ).toBe(false);
  });
  it("accepts adjacent shifts, other weekdays and inactive ones", () => {
    expect(validateShifts(seeded).ok).toBe(true);
    expect(validateShifts(late).ok).toBe(true);
    expect(
      validateShifts([
        sh("A", "11:00", "17:00", { weekdays: [1] }),
        sh("B", "12:00", "18:00", { weekdays: [2] }),
      ]).ok
    ).toBe(true);
    expect(
      validateShifts([
        sh("A", "11:00", "17:00"),
        sh("B", "12:00", "18:00", { active: false }),
      ]).ok
    ).toBe(true);
  });
  it("rejects empty names, equal times, bad times and no weekday", () => {
    expect(validateShifts([sh(" ", "10:00", "11:00")]).ok).toBe(false);
    expect(validateShifts([sh("X", "10:00", "10:00")]).ok).toBe(false);
    expect(validateShifts([sh("X", "10:99", "11:00")]).ok).toBe(false);
    expect(
      validateShifts([sh("X", "10:00", "11:00", { weekdays: [] })]).ok
    ).toBe(false);
  });
});
