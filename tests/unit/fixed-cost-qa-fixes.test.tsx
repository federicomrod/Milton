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

const LOC = "00000000-0000-4000-8000-00000000000a";
const NOV = "2026-11-01";
const OCT = "2026-10-01";

const view = (over: Record<string, unknown> = {}) =>
  ({
    month: NOV,
    currency: "USD",
    locationId: LOC,
    lines: [],
    items: {},
    versions: {},
    copy: null,
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
  const draft = {
    id: "d1",
    version: 1,
    fileName: "demo.csv",
    status: "draft",
    lines,
  };
  patches = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.endsWith("/approve")) {
      const picked = draft.lines.filter((l) => body.lineIds.includes(l.id));
      picked.forEach((l) => (l.status = "approved"));
      const months = [...new Set(picked.map((l) => l.month))];
      draft.version += 1;
      return new Response(
        JSON.stringify({
          status: "applied",
          command_id: "cmd-1",
          lines_approved: picked.length,
          lines_already_approved: 0,
          issues: [],
          draft: structuredClone(draft),
          preview: null,
          categories: months.map((m) => {
            const mine = picked.filter((l) => l.month === m);
            return {
              key: `${LOC}|${m}|servicios`,
              category: "servicios",
              month: m,
              location_id: LOC,
              outcome: "created",
              total: mine.reduce((n, l) => n + (l.amount as number), 0),
              previous_total: null,
              version: 1,
              repeats: true,
              line_ids: mine.map((l) => l.id),
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
    // Says where it went AND that the month on screen did not change.
    expect(toast.textContent).toContain(
      "Se guardó en octubre de 2026. noviembre de 2026 no cambió."
    );
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
  it("after an approval the page re-reads once and that authoritative read is what the cards show", async () => {
    const { rerender, ui } = mount([dline("l1", "Luz demo", 1800, NOV)]);
    fireEvent.click(
      within((await rows())[0]).getByRole("button", { name: "Aprobar" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800")
    );
    // The re-read asked for after the commit includes it.
    rerender(
      ui(
        view({ lines: [saved("servicios", 1800)], versions: { servicios: 1 } })
      )
    );
    expect(screen.getByTestId("fixed-total").textContent).toContain("$22,800");
    expect(
      screen.getByTestId("fixed-row-servicios").getAttribute("data-state")
    ).toBe("confirmed");
  });
});

describe("copied Servicios: source month and breakdown", () => {
  const cluster = (p: Record<string, unknown> = {}, items?: unknown[]) =>
    view({
      lines: [
        saved("servicios", 3900, {
          source: "repeat",
          label: "Agua + Seguro",
          detail_state: items ? "itemized" : "legacy_total",
          repeats: false,
          ...p,
        }),
      ],
      items: items ? { servicios: items } : {},
      groupShares: {},
    });
  const item = (id: string, label: string, cents: number, kind = "item") => ({
    id,
    label,
    cents,
    kind,
    version: 1,
    origin: {},
  });
  const known = [item("a", "Agua", 65000), item("b", "Seguro", 325000)];
  it("shows the breakdown and «copiado de octubre de 2026» when the copy recorded its source", () => {
    mount(
      [],
      {},
      cluster({ copy_source: { month: OCT, aggregate_version: 1010 } }, known)
    );
    const list = screen.getByTestId("fixed-items-servicios");
    expect(list.textContent).toContain("$3,250");
    expect(list.textContent).toContain("copiado de octubre de 2026");
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("breakdown but NO recorded source month: the detail still shows; no «no disponible» note", () => {
    mount([], {}, cluster({ copy_source: null }, known));
    expect(screen.getByTestId("fixed-items-servicios")).toBeTruthy();
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("a legacy total (no known detail) keeps its honest amount and says the breakdown is unavailable", () => {
    mount([], {}, cluster());
    expect(screen.queryByTestId("fixed-items-servicios")).toBeNull();
    expect(
      screen.getByTestId("fixed-detail-missing-servicios").textContent
    ).toBe("Desglose no disponible para este registro.");
    expect(screen.getByTestId("fixed-row-servicios").textContent).toContain(
      "$3,900"
    );
  });
  it("a hand-typed total is not «no disponible»: nothing was ever broken down", () => {
    mount([], {}, cluster({ source: "manual", label: null }));
    expect(screen.queryByTestId("fixed-detail-missing-servicios")).toBeNull();
  });
  it("an unknown legacy part sits next to the known items, flagged as such", () => {
    mount(
      [],
      {},
      cluster({ source: "upload", copy_source: null, amount: 4900 }, [
        item("base", "", 480000, "legacy_base"),
        item("s", "Seguro", 10000),
      ])
    );
    const list = screen.getByTestId("fixed-items-servicios");
    expect(list.textContent).toContain(
      "Desglose no disponible para este registro."
    );
    expect(list.textContent).toContain("$4,800");
    expect(list.textContent).toContain("Seguro");
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
    // An old copy row never recorded its source: it says so, it does not guess.
    expect(h).toContain(
      "Servicios · $4,800 · copiado de un mes anterior (origen no registrado)"
    );
    expect(h).not.toContain("Repitió");
  });
});

// Copies are an explicit database command now (migration 079): lineage, snapshots,
// double copies and tenant isolation are proven on Postgres in tests/pg/commands.test.ts
// and security.test.ts.
