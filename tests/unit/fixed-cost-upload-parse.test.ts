// #409 · reading a fixed-cost file into DRAFT lines. Invented names and
// amounts only.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  categoryTotals,
  detectCategory,
  duplicateTaxIds,
  isApprovable,
  issuesOf,
  normalizeAiLines,
  parseAmount,
  parseGrid,
  parseMonthCell,
  planApproval,
  scopeFromText,
  type DraftLine,
  type ReadDefaults,
} from "@/lib/restaurant/fixed-cost-upload";
import { gridFromSpreadsheet } from "@/lib/restaurant/fixed-cost-upload-server";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const defaults: ReadDefaults = {
  month: "2026-10-01",
  scope: { kind: "restaurant", locationId: A },
  locations: [
    { id: A, name: "Sucursal Demo Norte" },
    { id: B, name: "Sucursal Demo Sur" },
  ],
};

describe("cells", () => {
  it("reads amounts in both number formats; zero and text are «Sin precio»", () => {
    expect(parseAmount("$1,200.50")).toBe(1200.5);
    expect(parseAmount("1.200,50")).toBe(1200.5);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1,200")).toBe(1200);
    // a leading 0 is a decimal, never a thousands group
    expect(parseAmount("0.750")).toBe(0.75);
    expect(parseAmount("0,750")).toBe(0.75);
    expect(parseAmount("1.750")).toBe(1750);
    expect(parseAmount(850)).toBe(850);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
  it("names the category in es / en / de", () => {
    expect(detectCategory("Sueldos del personal")).toBe("planilla");
    expect(detectCategory("Monthly rent")).toBe("alquiler");
    expect(detectCategory("Luz y agua")).toBe("servicios");
    expect(detectCategory("Steuer")).toBe("impuestos");
    expect(detectCategory("Cosa rara")).toBeNull();
  });
  it("reads months", () => {
    expect(parseMonthCell("2026-10")).toBe("2026-10-01");
    expect(parseMonthCell("10/2026")).toBe("2026-10-01");
    expect(parseMonthCell("Octubre 2026")).toBe("2026-10-01");
    expect(parseMonthCell("???")).toBeNull();
  });
});

describe("a CSV with a header", () => {
  const csv = [
    "Concepto;Monto;Mes;Restaurante",
    "Nómina;21400;2026-10;",
    "Renta del local;6.500,00;octubre 2026;Sucursal Demo Sur",
    "Internet y luz;3900;;Grupo",
    "Cosa rara;120;;",
    "Seguro;sin dato;;",
    "Otros gastos;0;;",
    "Alquiler;500;2026-10;Sucursal Fantasma",
  ].join("\n");
  const grid = gridFromSpreadsheet(Buffer.from(csv), "costos.csv");
  const lines = parseGrid(
    grid.map((r) => (r.length === 1 ? String(r[0]).split(";") : r)),
    defaults
  );

  it("keeps EVERY row: nothing is dropped", () => {
    expect(lines).toHaveLength(7);
  });
  it("understands category, amount, month and restaurant", () => {
    expect(lines[0]).toMatchObject({
      category: "planilla",
      amount: 21400,
      month: "2026-10-01",
    });
    expect(lines[0].scope).toEqual({ kind: "restaurant", locationId: A });
    expect(lines[1]).toMatchObject({ category: "alquiler", amount: 6500 });
    expect(lines[1].scope).toEqual({ kind: "restaurant", locationId: B });
    expect(lines[2].scope).toEqual({ kind: "group" });
    expect(lines[2].month).toBe("2026-10-01"); // default month
  });
  it("unrecognized lines are shown with a flag, never approvable, never $0", () => {
    expect(lines[3]).toMatchObject({ category: null, amount: 120 });
    expect(issuesOf(lines[3])).toContain("category");
    expect(isApprovable(lines[3])).toBe(false);
  });
  it("an unreadable amount or a 0 is «Sin precio» (null), not 0", () => {
    expect(lines[4].amount).toBeNull();
    expect(lines[5].amount).toBeNull();
    expect(issuesOf(lines[4])).toContain("amount");
  });
  it("a restaurant that is not yours is flagged, not guessed", () => {
    expect(lines[6].scope).toBeNull();
    expect(issuesOf(lines[6])).toContain("restaurant");
  });
});

describe("an Excel file without a header", () => {
  it("reads concept in column A and amount in column B", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Renta", 6500],
      ["Planilla", 21400],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const lines = parseGrid(gridFromSpreadsheet(buf, "costos.xlsx"), defaults);
    expect(lines.map((l) => [l.category, l.amount])).toEqual([
      ["alquiler", 6500],
      ["planilla", 21400],
    ]);
    expect(
      lines.every((l) => l.from === "file" && l.status === "pending")
    ).toBe(true);
  });
});

describe("lines read by AI (PDF, photo)", () => {
  it("are drafts tagged «ai», keep unrecognized lines and never invent an amount", () => {
    const lines = normalizeAiLines(
      {
        lines: [
          {
            label: "Alquiler local",
            category: "alquiler",
            amount: 7000,
            month: "2026-10",
            restaurant: null,
          },
          { label: "Concepto raro", category: null, amount: null },
          { label: "Luz", category: "nonsense", amount: "1.200,00" },
        ],
      },
      defaults
    );
    expect(lines.map((l) => l.from)).toEqual(["ai", "ai", "ai"]);
    expect(lines[1]).toMatchObject({ category: null, amount: null });
    expect(lines[2]).toMatchObject({ category: "servicios", amount: 1200 });
    expect(normalizeAiLines("junk", defaults)).toEqual([]);
  });
});

describe("approval plan", () => {
  const line = (over: Partial<DraftLine>): DraftLine => ({
    id: "l1",
    raw: "Renta",
    category: "alquiler",
    amount: 7000,
    month: "2026-10-01",
    scope: { kind: "restaurant", locationId: A },
    from: "file",
    status: "pending",
    ...over,
  });
  const key = `${A}|2026-10-01|alquiler`;

  it("a new value is a plain write", () => {
    const p = planApproval([line({})], new Map());
    expect(p.writes).toHaveLength(1);
    expect(p.conflicts).toHaveLength(0);
  });
  it("a different existing value is a conflict (old → new)", () => {
    const p = planApproval(
      [line({})],
      new Map([[key, { amount: 6500, pct_of_sales: null }]])
    );
    expect(p.conflicts).toEqual([
      expect.objectContaining({ lineId: "l1", old: 6500, new: 7000 }),
    ]);
  });
  it("the same value changes nothing", () => {
    const p = planApproval(
      [line({})],
      new Map([[key, { amount: 7000, pct_of_sales: null }]])
    );
    expect(p.writes).toHaveLength(0);
    expect(p.unchanged).toHaveLength(1);
  });
  it("lines with issues wait; the rest are written", () => {
    const p = planApproval(
      [line({ id: "a" }), line({ id: "c", category: null })],
      new Map()
    );
    expect(p.writes.map((w) => w.line.id)).toEqual(["a"]);
    expect(p.blocked.map((l) => l.id)).toEqual(["c"]);
  });
  it("3 servicios lines of one month and restaurant are ONE write: the sum, parts joined", () => {
    const p = planApproval(
      [
        line({ id: "a", category: "servicios", raw: "Luz", amount: 100.1 }),
        line({ id: "b", category: "servicios", raw: "Agua", amount: 50.2 }),
        line({ id: "c", category: "servicios", raw: "Internet", amount: 30 }),
      ],
      new Map()
    );
    expect(p.writes).toHaveLength(1);
    expect(p.blocked).toHaveLength(0);
    expect(p.writes[0].line).toMatchObject({
      amount: 180.3,
      raw: "Luz + Agua + Internet",
    });
    expect(p.writes[0].members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
  it("the joined label is cut to the 120-character limit", () => {
    const long = "x".repeat(60);
    const p = planApproval(
      [
        line({ id: "a", raw: long }),
        line({ id: "b", raw: long }),
        line({ id: "c", raw: long }),
      ],
      new Map()
    );
    expect(p.writes[0].line.raw.length).toBe(120);
  });
  it("the sum is what is compared with the existing value", () => {
    const k = `${A}|2026-10-01|servicios`;
    const three = [
      line({ id: "a", category: "servicios", amount: 100 }),
      line({ id: "b", category: "servicios", amount: 50 }),
      line({ id: "c", category: "servicios", amount: 30 }),
    ];
    const diff = planApproval(
      three,
      new Map([[k, { amount: 100, pct_of_sales: null }]])
    );
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ lineId: "a", old: 100, new: 180 }),
    ]);
    const same = planApproval(
      three,
      new Map([[k, { amount: 180, pct_of_sales: null }]])
    );
    expect(same.writes).toHaveLength(0);
    expect(same.unchanged).toHaveLength(3);
  });
  it("two impuestos lines of one key are flagged, never summed", () => {
    const two = [
      line({ id: "a", category: "impuestos", amount: 10 }),
      line({ id: "b", category: "impuestos", amount: 6 }),
    ];
    expect([...duplicateTaxIds(two)]).toEqual(["a", "b"]);
    const p = planApproval(two, new Map());
    expect(p.writes).toHaveLength(0);
    expect(p.blocked.map((l) => l.id)).toEqual(["a", "b"]);
    // once the person keeps one, it goes through
    const kept = planApproval([two[0]], new Map());
    expect(kept.writes).toHaveLength(1);
  });
  it("the review shows the combined total per category", () => {
    const totals = categoryTotals([
      line({ id: "a", category: "servicios", amount: 100 }),
      line({ id: "b", category: "servicios", amount: 50 }),
      line({ id: "c" }),
    ]);
    expect(totals.find((t) => t.category === "servicios")).toMatchObject({
      lines: 2,
      total: 150,
    });
  });
  it("impuestos is a rate up to 100", () => {
    expect(isApprovable(line({ category: "impuestos", amount: 16 }))).toBe(
      true
    );
    expect(isApprovable(line({ category: "impuestos", amount: 160 }))).toBe(
      false
    );
  });
});

describe("which restaurant a text means", () => {
  const two = [
    { id: A, name: "Los Ranchos Centro" },
    { id: B, name: "Los Ranchos Escalón" },
  ];
  it("a shared prefix is not guessed", () => {
    expect(scopeFromText("Los Ranchos", two)).toBeNull();
    expect(scopeFromText("Los", two)).toBeNull();
  });
  it("an exact name wins; a unique partial of 4+ characters matches", () => {
    expect(scopeFromText("Los Ranchos Escalón", two)).toEqual({
      kind: "restaurant",
      locationId: B,
    });
    expect(scopeFromText("los ranchos escalon", two)).toEqual({
      kind: "restaurant",
      locationId: B,
    });
    expect(scopeFromText("centro", two)).toEqual({
      kind: "restaurant",
      locationId: A,
    });
  });
  it("a partial shorter than 4 characters is not enough", () => {
    expect(scopeFromText("cen", two)).toBeNull();
  });
  it("AI-read lines follow the same rule", () => {
    const lines = normalizeAiLines(
      {
        lines: [
          {
            label: "Luz",
            category: "servicios",
            amount: 90,
            restaurant: "Los Ranchos",
          },
          {
            label: "Luz",
            category: "servicios",
            amount: 90,
            restaurant: "Centro",
          },
        ],
      },
      { ...defaults, locations: two }
    );
    expect(lines[0].scope).toBeNull();
    expect(lines[1].scope).toEqual({ kind: "restaurant", locationId: A });
  });
});
