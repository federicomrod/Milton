// The multi-month overview: what is recorded, what is a reference, what is
// missing, and how the totals add up. Synthetic fixtures only.
import { describe, expect, it } from "vitest";
import {
  buildOverview,
  monthWindow,
  shiftMonth,
} from "@/lib/restaurant/fixed-cost-overview";
import {
  NOV,
  OCT,
  SEP,
  acceptance,
  item,
  line,
  monthInput,
} from "./fixtures/fixed-cost-redesign";

describe("window", () => {
  it("shows the three months ending in the selected one", () => {
    expect(monthWindow(NOV)).toEqual([SEP, OCT, NOV]);
    expect(monthWindow("2026-01-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
    expect(shiftMonth(NOV, -1)).toBe(OCT);
  });
});

describe("acceptance fixtures", () => {
  const { sep, oct, nov } = acceptance();
  const ov = buildOverview([sep, oct, nov]);
  const [s, o, n] = ov.months;

  it("October local = 32 920; shared 21 000 is separate; combined = 53 920", () => {
    expect(o.localTotal).toBe(32920);
    expect(o.sharedTotal).toBe(21000);
    expect(o.combinedTotal).toBe(53920);
    expect(o.localTotal! + o.sharedTotal!).toBe(o.combinedTotal);
  });

  it("the 13 % is a rate, never cash", () => {
    expect(o.taxRate).toBe(13);
    expect(o.combinedTotal).toBe(53920);
    expect(o.localTotal).toBe(32920);
  });

  it("services detail: five items, each once, summing to 4 900", () => {
    const rows = ov.positions.servicios;
    expect(rows.map((r) => r.label)).toEqual([
      "Agua",
      "Electricidad",
      "Gas",
      "Internet",
      "Seguro",
    ]);
    const sum = rows.reduce((t, r) => t + (r.amounts[OCT]?.amount ?? 0), 0);
    expect(sum).toBe(4900);
    expect(o.cells.servicios.amount).toBe(4900);
  });

  it("November keeps its recorded 25 800 and is partial with named gaps", () => {
    expect(n.localTotal).toBe(25800);
    expect(n.completeness).toBe("partial");
    expect(n.missing).toEqual(["servicios", "otros"]);
    expect(n.breakEvenPerDay).toBeNull();
  });

  it("an empty month has no total at all: never 0", () => {
    expect(s.localTotal).toBeNull();
    expect(s.combinedTotal).toBeNull();
    expect(s.completeness).toBe("none");
    expect(s.cells.planilla.state).toBe("missing");
    expect(s.cells.planilla.amount).toBeNull();
  });

  it("a complete month shows a daily target; a partial month never does", () => {
    expect(o.completeness).toBe("complete");
    expect(o.breakEvenPerDay).not.toBeNull();
    expect(n.breakEvenPerDay).toBeNull();
  });
});

describe("missing is not zero; a confirmed zero is its own state", () => {
  it("distinguishes missing, zero, draft and recorded", () => {
    const ov = buildOverview([
      monthInput(OCT, [
        line(OCT, "planilla", 0),
        line(OCT, "alquiler", 6500),
        line(OCT, "servicios", 900, { status: "draft" }),
      ]),
    ]);
    const c = ov.months[0].cells;
    expect(c.planilla.state).toBe("zero");
    expect(c.planilla.amount).toBe(0);
    expect(c.alquiler.state).toBe("recorded");
    expect(c.servicios.state).toBe("draft");
    expect(c.servicios.amount).toBeNull();
    expect(c.otros.state).toBe("missing");
    expect(ov.months[0].localTotal).toBe(6500);
  });
});

describe("recurring references", () => {
  it("is an expectation shown next to the gap and never added to a total", () => {
    const ov = buildOverview([
      monthInput(OCT, [line(OCT, "alquiler", 6500, { repeats: true })]),
      monthInput(NOV, []),
    ]);
    const nov = ov.months[1];
    expect(nov.cells.alquiler.state).toBe("recurring");
    expect(nov.cells.alquiler.reference).toBe(6500);
    expect(nov.cells.alquiler.referenceMonth).toBe(OCT);
    expect(nov.cells.alquiler.amount).toBeNull();
    expect(nov.localTotal).toBeNull();
    expect(nov.combinedTotal).toBeNull();
  });

  it("does not recur from a line that is not marked recurring, or from the future", () => {
    const ov = buildOverview([
      monthInput(SEP, [line(SEP, "alquiler", 100, { repeats: false })]),
      monthInput(OCT, []),
      monthInput(NOV, [line(NOV, "alquiler", 6500, { repeats: true })]),
    ]);
    expect(ov.months[1].cells.alquiler.state).toBe("missing");
    expect(ov.months[0].cells.alquiler.state).toBe("recorded");
  });

  it("finds a reference from before the window", () => {
    const ov = buildOverview(
      [monthInput(NOV, [])],
      [line("2026-08-01", "otros", 90, { repeats: true })]
    );
    expect(ov.months[0].cells.otros.state).toBe("recurring");
    expect(ov.months[0].cells.otros.referenceMonth).toBe("2026-08-01");
  });
});

describe("no invented detail", () => {
  it("a legacy aggregate has one flagged unknown-detail position, not a breakdown", () => {
    const ov = buildOverview([
      monthInput(OCT, [line(OCT, "servicios", 4900)], {
        items: { servicios: [item("b", null, 4900, "legacy_base")] },
      }),
    ]);
    const rows = ov.positions.servicios;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("legacy_base");
    expect(ov.months[0].cells.servicios.detail).toBe("legacy_total");
  });

  it("a category with a total and no items has no positions", () => {
    const ov = buildOverview([monthInput(OCT, [line(OCT, "otros", 120)])]);
    expect(ov.positions.otros).toEqual([]);
  });

  it("items sharing a label across months align in one position", () => {
    const ov = buildOverview([
      monthInput(SEP, [line(SEP, "servicios", 100)], {
        items: { servicios: [item("a", "Agua", 100)] },
      }),
      monthInput(OCT, [line(OCT, "servicios", 650)], {
        items: { servicios: [item("b", "agua ", 650)] },
      }),
    ]);
    expect(ov.positions.servicios).toHaveLength(1);
    expect(ov.positions.servicios[0].amounts[SEP]?.amount).toBe(100);
    expect(ov.positions.servicios[0].amounts[OCT]?.amount).toBe(650);
  });
});

describe("group shares", () => {
  it("are counted once: combined = local + shared, never local + shared twice", () => {
    const m = buildOverview([
      monthInput(OCT, [line(OCT, "alquiler", 100)], {
        shared: { alquiler: 50, servicios: 25 },
      }),
    ]).months[0];
    expect(m.localTotal).toBe(100);
    expect(m.sharedTotal).toBe(75);
    expect(m.combinedTotal).toBe(175);
  });
});
