// @vitest-environment jsdom
// Costos fijos QA after #494: the destination month is visible and never moved
// silently; counts say what they count; the break-even says when it is partial;
// a copy keeps its source month and breakdown; a late read never overwrites a
// newer change. Synthetic demo data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {}, prefetch() {} }),
}));
vi.mock("@/lib/restaurant/currency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/restaurant/currency")>()),
  resolveCompanyCurrency: async () => "USD",
}));

import { FixedCostsTab } from "@/components/restaurant/costs/FixedCostsTab";
import { figuresOf } from "@/lib/restaurant/fixed-cost-clusters";
import {
  loadRepeatDetail,
  repeatFixedCosts,
} from "@/lib/restaurant/fixed-costs-server";
import { fakeSupabase } from "./helpers/fake-memory-db";

const LOC = "00000000-0000-4000-8000-00000000000a";
const LOC2 = "00000000-0000-4000-8000-00000000000b";
const NOV = "2026-11-01";
const OCT = "2026-10-01";
const DEC = "2026-12-01";

const view = (over: Record<string, unknown> = {}) =>
  ({
    month: NOV,
    currency: "USD",
    locationId: LOC,
    lines: [],
    groupShares: { servicios: 21000 },
    groupImpuestosPct: null,
    openDays: 30,
    margin: { sales: 100000, foodCost: 30000 },
    marginReason: null,
    breakEven: null,
    lastMonth: {},
    ...over,
  }) as never;

const saved = (category: string, amount: number, over = {}) => ({
  location_id: LOC,
  month: NOV,
  category,
  label: null,
  amount: category === "impuestos" ? null : amount,
  pct_of_sales: category === "impuestos" ? amount : null,
  currency: "USD",
  source: "upload",
  status: "confirmed",
  repeats: true,
  split_rule: null,
  ...over,
});

const dline = (id: string, raw: string, amount: number, month: string) => ({
  id,
  raw,
  category: "servicios",
  amount,
  month,
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
});

let patches: any[] = [];
function mount(lines: any[], props: Record<string, unknown> = {}, v = view()) {
  const draft = { id: "d1", fileName: "demo.csv", status: "draft", lines };
  patches = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.endsWith("/approve")) {
      const picked = draft.lines.filter((l) => body.lineIds.includes(l.id));
      picked.forEach((l) => (l.status = "approved"));
      const months = [...new Set(picked.map((l) => l.month))];
      return new Response(
        JSON.stringify({
          approved: picked.length,
          issues: [],
          draft: structuredClone(draft),
          applied: months.map((m) => {
            const mine = picked.filter((l) => l.month === m);
            return {
              category: "servicios",
              month: m,
              locationId: LOC,
              total: mine.reduce((n, l) => n + (l.amount as number), 0),
              previous: null,
              repeats: true,
              lineIds: mine.map((l) => l.id),
            };
          }),
        }),
        { status: 200 }
      );
    }
    if (init?.method === "PATCH") {
      patches.push(body);
      for (const e of body.edits ?? []) {
        const l = draft.lines.find((x) => x.id === e.lineId)!;
        if (e.month !== undefined) l.month = e.month;
      }
    }
    return new Response(JSON.stringify({ draft: structuredClone(draft) }), {
      status: 200,
    });
  });
  const ui = (vv = v) => (
    <FixedCostsTab
      view={vv}
      history={[]}
      locationName="Demo"
      shellParams={{}}
      currentMonth={NOV}
      restaurants={[{ id: LOC, name: "Demo" }]}
      {...props}
    />
  );
  const r = render(ui());
  return { ...r, ui };
}
const rows = () => screen.findAllByTestId("upload-line");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("destination month: visible before approval, never moved silently", () => {
  it("a line for the month on screen: card, total and target move at once; no month tag", async () => {
    mount([dline("l1", "Luz demo", 1800, NOV)]);
    const row = (await rows())[0];
    expect(within(row).queryByTestId("month-tag")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800")
    );
    expect(
      screen.getByTestId("fixed-row-servicios").getAttribute("data-state")
    ).not.toBe("empty");
  });

  it("a line dated another month shows «Se guardará en octubre de 2026» before approving", async () => {
    mount([dline("l1", "Luz demo", 1800, OCT)]);
    const row = (await rows())[0];
    expect(within(row).getByTestId("month-tag").textContent).toContain(
      "Se guardará en octubre de 2026"
    );
    expect(
      within(row).getByRole("button", { name: "Usar noviembre de 2026" })
    ).toBeTruthy();
  });

  it("approving it as is saves to ITS month: this screen does not change and the toast names the month", async () => {
    mount([dline("l1", "Luz demo", 1800, OCT)]);
    const row = (await rows())[0];
    fireEvent.click(within(row).getByRole("button", { name: "Aprobar" }));
    const toast = await screen.findByTestId("approve-toast");
    expect(toast.textContent).toContain("1 línea aprobada");
    expect(toast.textContent).toContain("octubre de 2026");
    expect(
      within(toast).getByRole("button", { name: "Ver octubre de 2026" })
    ).toBeTruthy();
    expect(screen.getByTestId("fixed-total").textContent).toContain("$21,000");
    expect(patches).toHaveLength(0); // nothing was moved behind the person's back
  });

  it("«Usar noviembre de 2026» changes the saved month (PATCH), then the approval lands on screen", async () => {
    mount([dline("l1", "Luz demo", 1800, OCT)]);
    const row = (await rows())[0];
    fireEvent.click(
      within(row).getByRole("button", { name: "Usar noviembre de 2026" })
    );
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].edits[0]).toMatchObject({ lineId: "l1", month: NOV });
    await waitFor(() => expect(screen.queryByTestId("month-tag")).toBeNull());
    fireEvent.click(
      within((await rows())[0]).getByRole("button", { name: "Aprobar" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800")
    );
  });
});

describe("counts say what they count", () => {
  it("two Servicios lines: «2 líneas aprobadas», one category confirmed", async () => {
    mount([
      dline("l1", "Luz demo", 1800, NOV),
      dline("l2", "Agua demo", 650, NOV),
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: /Aprobar todo/ })
    );
    const toast = await screen.findByTestId("approve-toast");
    expect(toast.textContent).toContain("2 líneas aprobadas");
    await waitFor(() =>
      expect(screen.getByTestId("confirmed-pill").textContent).toBe(
        "Categorías confirmadas: 1 de 5"
      )
    );
    expect(screen.getByText("Categorías confirmadas")).toBeTruthy();
  });
});

describe("partial break-even", () => {
  const five = [
    saved("planilla", 20000),
    saved("alquiler", 7000),
    saved("servicios", 4000),
    saved("otros", 500),
    saved("impuestos", 10),
  ];
  it("missing categories → «Punto de equilibrio parcial» + the note; group share stays in", () => {
    mount(
      [],
      {},
      view({ lines: [saved("servicios", 4800, { source: "repeat" })] })
    );
    expect(screen.getByTestId("break-even-partial-title").textContent).toBe(
      "Punto de equilibrio parcial"
    );
    expect(screen.getByTestId("break-even-partial-note").textContent).toBe(
      "Calculado solo con los costos confirmados. Faltan categorías por confirmar."
    );
    expect(screen.getByTestId("fixed-total").textContent).toContain("$25,800");
  });
  it("only a group share → partial, not «—»", () => {
    mount([], {}, view());
    expect(screen.getByTestId("break-even-partial-title")).toBeTruthy();
    expect(screen.getAllByTestId("break-even-value")[0].textContent).not.toBe(
      "—"
    );
  });
  it("nothing confirmed and no group share → «—», no title", () => {
    mount([], {}, view({ groupShares: {} }));
    expect(screen.queryByTestId("break-even-partial-title")).toBeNull();
    expect(screen.getByTestId("fixed-total").textContent).toContain("—");
  });
  it("complete coverage restores the normal heading", () => {
    mount([], {}, view({ lines: five, groupShares: {} }));
    expect(screen.queryByTestId("break-even-partial-title")).toBeNull();
    expect(screen.queryByTestId("break-even-partial-note")).toBeNull();
  });
  it("a confirmed 0 is a figure, not a gap (lib)", () => {
    const f = (zero: boolean) =>
      figuresOf({
        clusters: {
          planilla: { value: zero ? 0 : 1, source: "manual", label: null },
          alquiler: { value: 1, source: "manual", label: null },
          servicios: { value: 1, source: "manual", label: null },
          otros: { value: 1, source: "manual", label: null },
          impuestos: { value: 5, source: "manual", label: null },
        },
        groupShares: {},
        groupImpuestosPct: null,
        margin: { sales: 100000, foodCost: 30000 },
        openDays: 30,
      });
    expect(f(true).incomplete).toBe(false);
    expect(
      figuresOf({
        clusters: {},
        groupShares: {},
        groupImpuestosPct: null,
        margin: null,
        openDays: 30,
      }).incomplete
    ).toBe(true);
  });
});

describe("a late read never overwrites a newer change", () => {
  it("without local changes, what the server re-reads is taken", () => {
    const { rerender, ui } = mount([]);
    rerender(ui(view({ lines: [saved("planilla", 20000)], groupShares: {} })));
    expect(
      screen.getByTestId("fixed-row-planilla").getAttribute("data-state")
    ).not.toBe("empty");
  });
  it("after a local approval, an older read (without it) does not wipe the card", async () => {
    const { rerender, ui } = mount([dline("l1", "Luz demo", 1800, NOV)]);
    fireEvent.click(
      within((await rows())[0]).getByRole("button", { name: "Aprobar" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800")
    );
    rerender(ui(view({ lines: [] }))); // a read asked for before the approval
    expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800");
  });
});

describe("copied Servicios: source month and breakdown", () => {
  const cluster = (p: Record<string, unknown> = {}) =>
    view({
      lines: [
        saved("servicios", 3900, {
          source: "repeat",
          label: "Agua + Seguro",
          ...p,
        }),
      ],
      groupShares: {},
    });
  const items = [
    { raw: "Agua", amount: 650 },
    { raw: "Seguro", amount: 3250 },
  ];
  it("shows the breakdown and «copiado de octubre de 2026» when the log kept both", () => {
    mount(
      [],
      { repeatDetail: { servicios: { fromMonth: OCT, items } } },
      cluster()
    );
    const list = screen.getByTestId("fixed-items-servicios");
    expect(list.textContent).toContain("$3,250");
    expect(list.textContent).toContain("copiado de octubre de 2026");
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("breakdown but NO source month: the detail still shows; no «no disponible» note", () => {
    mount(
      [],
      { repeatDetail: { servicios: { fromMonth: null, items } } },
      cluster()
    );
    expect(screen.getByTestId("fixed-items-servicios")).toBeTruthy();
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("legacy aggregate-only (several concepts in the label, no breakdown): the note", () => {
    mount([], { repeatDetail: {} }, cluster());
    expect(screen.queryByTestId("fixed-items-servicios")).toBeNull();
    expect(
      screen.getByTestId("fixed-detail-missing-servicios").textContent
    ).toBe("Desglose no disponible para este registro.");
  });
  it("a single-concept copy is not «no disponible»", () => {
    mount([], {}, cluster({ label: "Alquiler demo" }));
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("a breakdown that no longer adds up is not shown, and not invented", () => {
    mount(
      [],
      { repeatDetail: { servicios: { fromMonth: OCT, items } } },
      cluster({ amount: 4000 })
    );
    expect(screen.queryByTestId("fixed-items-servicios")).toBeNull();
  });
  it("History: «copiado de octubre de 2026» only when the log stored the month", () => {
    const row = (id: string, nv: Record<string, unknown>) => ({
      id,
      created_at: new Date().toISOString(),
      actor: null,
      action: "repeat",
      category: "servicios",
      month: NOV,
      location_id: LOC,
      old_value: null,
      new_value: { amount: 4800, pct_of_sales: null, ...nv },
      source: "repeat",
    });
    render(
      <FixedCostsTab
        view={view()}
        history={[row("h1", { from_month: OCT }), row("h2", {})] as never}
        locationName="Demo"
        shellParams={{}}
        currentMonth={NOV}
        restaurants={[{ id: LOC, name: "Demo" }]}
      />
    );
    const h = screen.getByTestId("history").textContent ?? "";
    expect(h).toContain("Servicios · $4,800 · copiado de octubre de 2026");
    expect(h).toContain("Servicios · $4,800 · repetido automáticamente");
    expect(h).not.toContain("Repitió");
  });
});

// ---------------------------------------------------------------------------
// Server: the copy keeps its source month and breakdown in the log
// ---------------------------------------------------------------------------
const lineRow = (over: Record<string, unknown> = {}) => ({
  id: "fc-oct",
  company_id: "c1",
  location_id: LOC,
  month: OCT,
  category: "servicios",
  label: "Luz + Agua",
  amount: 2450,
  pct_of_sales: null,
  currency: "USD",
  source: "upload",
  status: "confirmed",
  repeats: true,
  split_rule: null,
  ...over,
});
const draftRow = (over: Record<string, unknown> = {}) => ({
  id: "d-oct",
  company_id: "c1",
  status: "approved",
  created_at: "2026-10-05T10:00:00Z",
  file_name: "demo.csv",
  parsed_lines: [
    {
      id: "a",
      raw: "Luz",
      category: "servicios",
      amount: 1800,
      month: OCT,
      scope: { kind: "restaurant", locationId: LOC },
      from: "file",
      status: "approved",
    },
    {
      id: "b",
      raw: "Agua",
      category: "servicios",
      amount: 650,
      month: OCT,
      scope: { kind: "restaurant", locationId: LOC },
      from: "file",
      status: "approved",
    },
  ],
  ...over,
});
const ctxOf = (db: ReturnType<typeof fakeSupabase>, companyId = "c1") => ({
  supabase: db.client,
  companyId,
  userId: "u1",
});
const names = (d: any) =>
  d.servicios?.items?.map((i: any) => [i.raw, i.amount]);

describe("repeatFixedCosts keeps provenance and breakdown (log, no migration)", () => {
  it("stores from_month + items; they come back after a reload; the sum matches the total", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow()],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [draftRow()],
    });
    const made = await repeatFixedCosts(ctxOf(db), NOV);
    expect(made).toHaveLength(1);
    expect(made[0].amount).toBe(2450);
    const detail = await loadRepeatDetail(ctxOf(db), {
      month: NOV,
      locationId: LOC,
    });
    expect(detail.servicios?.fromMonth).toBe(OCT);
    expect(names(detail)).toEqual([
      ["Luz", 1800],
      ["Agua", 650],
    ]);
    expect(detail.servicios!.items!.reduce((n, i) => n + i.amount, 0)).toBe(
      2450
    );
  });
  it("a second copy changes nothing: no double count, same detail", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow()],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [draftRow()],
    });
    await repeatFixedCosts(ctxOf(db), NOV);
    const again = await repeatFixedCosts(ctxOf(db), NOV);
    expect(again).toHaveLength(0);
    const nov = db.tables.restaurant_fixed_costs.filter(
      (r: any) => r.month === NOV
    );
    expect(nov).toHaveLength(1);
    const detail = await loadRepeatDetail(ctxOf(db), {
      month: NOV,
      locationId: LOC,
    });
    expect(names(detail)).toEqual([
      ["Luz", 1800],
      ["Agua", 650],
    ]);
  });
  it("a copy of a copy (Nov → Dic) keeps the breakdown and names November as its source", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow()],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [draftRow()],
    });
    await repeatFixedCosts(ctxOf(db), NOV);
    await repeatFixedCosts(ctxOf(db), DEC);
    const dec = await loadRepeatDetail(ctxOf(db), {
      month: DEC,
      locationId: LOC,
    });
    expect(dec.servicios?.fromMonth).toBe(NOV);
    expect(names(dec)).toEqual([
      ["Luz", 1800],
      ["Agua", 650],
    ]);
  });
  it("legacy aggregate-only source (no drafts): month stored, NO items invented", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow()],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [],
    });
    await repeatFixedCosts(ctxOf(db), NOV);
    const detail = await loadRepeatDetail(ctxOf(db), {
      month: NOV,
      locationId: LOC,
    });
    expect(detail.servicios?.fromMonth).toBe(OCT);
    expect(detail.servicios?.items).toBeUndefined();
  });
  it("lines that no longer add up to the source amount are not copied as detail", async () => {
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow({ amount: 3000 })], // edited by hand since
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [draftRow()],
    });
    await repeatFixedCosts(ctxOf(db), NOV);
    const detail = await loadRepeatDetail(ctxOf(db), {
      month: NOV,
      locationId: LOC,
    });
    expect(detail.servicios?.items).toBeUndefined();
  });
  it("another restaurant's / another company's draft or log is never used or returned", async () => {
    const other = draftRow({
      id: "d-other",
      company_id: "c2",
      parsed_lines: draftRow().parsed_lines.map((l: any) => ({
        ...l,
        scope: { kind: "restaurant", locationId: LOC2 },
      })),
    });
    const db = fakeSupabase({
      restaurant_fixed_costs: [lineRow()],
      restaurant_fixed_costs_log: [],
      fixed_cost_upload_drafts: [other], // not c1's, not LOC
    });
    await repeatFixedCosts(ctxOf(db), NOV);
    const mine = await loadRepeatDetail(ctxOf(db), {
      month: NOV,
      locationId: LOC,
    });
    expect(mine.servicios?.items).toBeUndefined();
    expect(
      await loadRepeatDetail(ctxOf(db, "c2"), { month: NOV, locationId: LOC })
    ).toEqual({});
    expect(
      await loadRepeatDetail(ctxOf(db), { month: NOV, locationId: LOC2 })
    ).toEqual({});
    expect(
      await loadRepeatDetail(ctxOf(db), { month: NOV, locationId: null })
    ).toEqual({});
  });
  it("only rows with «Se repite» ON are copied", async () => {
    const off = (category: string) =>
      lineRow({ id: `x-${category}`, category, repeats: false });
    const db = fakeSupabase({
      restaurant_fixed_costs: [
        lineRow(),
        off("planilla"),
        off("alquiler"),
        off("otros"),
      ],
      restaurant_fixed_costs_log: [],
    });
    const made = await repeatFixedCosts(ctxOf(db), NOV);
    expect(made.map((l) => l.category)).toEqual(["servicios"]);
  });
});
