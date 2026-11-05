// @vitest-environment jsdom
// Fixed-cost upload, inline approval (release blocker). Approving lines must
// reach the cluster totals and the break-even at once, with no reload and no
// modal; the lines move into «Aprobadas (n)»; «Deshacer» puts it back; a failed
// save rolls back with a message. A tiny fake server mirrors the real rules
// (same-category lines add up).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh, replace() {} }),
}));

import { FixedCostsTab } from "@/components/restaurant/costs/FixedCostsTab";

const LOC = "00000000-0000-4000-8000-00000000000a";
const MONTH = "2026-10-01";
const mk = (
  id: string,
  raw: string,
  category: string | null,
  amount: number | null
) => ({
  id,
  raw,
  category,
  amount,
  month: MONTH,
  scope: { kind: "restaurant", locationId: LOC },
  from: "file",
  status: "pending",
});
const FIVE = [
  mk("l1", "Nómina demo", "planilla", 20000),
  mk("l2", "Renta demo", "alquiler", 7000),
  mk("l3", "Luz demo", "servicios", 1800),
  mk("l4", "Agua demo", "servicios", 650),
  mk("l5", "Gastos varios demo", "otros", 500),
];

interface Server {
  draft: { id: string; fileName: string; status: string; lines: any[] };
  calls: string[];
  failApprove: boolean;
  approvedTotals: Record<string, number>;
}
let server: Server;

function installFetch() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status });
    if (u.endsWith("/approve")) {
      server.calls.push("approve");
      if (server.failApprove) return json({ error: "boom" }, 500);
      const ids: string[] = body.lineIds;
      const applied: any[] = [];
      for (const id of ids) {
        const l = server.draft.lines.find((x) => x.id === id);
        l.status = "approved";
      }
      const cats = [
        ...new Set(
          ids.map((id) => server.draft.lines.find((x) => x.id === id).category)
        ),
      ];
      for (const c of cats) {
        const sum = server.draft.lines
          .filter((x) => x.status === "approved" && x.category === c)
          .reduce((n, x) => n + x.amount, 0);
        const previous =
          c in server.approvedTotals
            ? {
                amount: server.approvedTotals[c],
                pct_of_sales: null,
                label: null,
                source: "upload",
              }
            : null;
        server.approvedTotals[c] = sum;
        applied.push({
          category: c,
          month: MONTH,
          locationId: LOC,
          total: sum,
          previous,
          lineIds: ids.filter(
            (id) => server.draft.lines.find((x) => x.id === id).category === c
          ),
        });
      }
      const open = server.draft.lines.some((x) => x.status === "pending");
      server.draft.status = open ? "draft" : "approved";
      return json({
        approved: applied.length,
        issues: [],
        applied,
        draft: structuredClone(server.draft),
      });
    }
    if (u.endsWith("/undo")) {
      server.calls.push("undo");
      for (const a of body.applied) {
        for (const id of a.lineIds)
          server.draft.lines.find((x) => x.id === id).status = "pending";
        if (a.previous) server.approvedTotals[a.category] = a.previous.amount;
        else delete server.approvedTotals[a.category];
      }
      server.draft.status = "draft";
      return json({ draft: structuredClone(server.draft) });
    }
    if (init?.method === "PATCH") {
      server.calls.push("patch");
      for (const e of body.edits ?? []) {
        const l = server.draft.lines.find((x) => x.id === e.lineId);
        if (e.discard) l.status = "discarded";
        if (e.category !== undefined) l.category = e.category;
        if (e.amount !== undefined) l.amount = e.amount;
      }
      return json({ draft: structuredClone(server.draft) });
    }
    return json({ draft: structuredClone(server.draft) });
  });
}

function view(over: Record<string, unknown> = {}) {
  return {
    month: MONTH,
    currency: "USD",
    locationId: LOC,
    lines: [],
    groupShares: {},
    groupImpuestosPct: null,
    openDays: 30,
    margin: { sales: 100000, foodCost: 30000 },
    marginReason: null,
    breakEven: null,
    lastMonth: {},
    ...over,
  } as never;
}
function show(lines = FIVE, v = view()) {
  server = {
    draft: {
      id: "d1",
      fileName: "costos-demo.csv",
      status: "draft",
      lines: structuredClone(lines),
    },
    calls: [],
    failApprove: false,
    approvedTotals: {},
  };
  installFetch();
  render(
    <FixedCostsTab
      view={v}
      history={[]}
      locationName="Demo"
      shellParams={{}}
      currentMonth={MONTH}
    />
  );
}
const lineRow = async (name: string) =>
  (await screen.findAllByTestId("upload-line")).find((r) =>
    r.textContent?.includes(name)
  )!;

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("root cause", () => {
  it("approved lines reach the cluster fields (they used to stay empty)", async () => {
    show([FIVE[3]]);
    expect(screen.getByTestId("fixed-total").textContent).toContain("—"); // never $0
    fireEvent.click(
      within(await lineRow("Agua demo")).getByRole("button", {
        name: "Aprobar",
      })
    );
    const servicios = await screen.findByTestId("fixed-derived-servicios");
    expect(servicios.textContent).toContain("$650");
    expect(screen.getByTestId("fixed-total").textContent).toContain("$650");
  });
});

describe("5 lines → Aprobar todo", () => {
  it("lands in the right clusters, totals and break-even change, no reload, one click", async () => {
    show();
    expect(screen.getAllByTestId("break-even")[0].textContent).toContain(
      "Falta"
    );
    let clicks = 0;
    const click = (el: HTMLElement) => {
      clicks++;
      fireEvent.click(el);
    };
    click(
      await screen.findByRole("button", {
        name: /^Aprobar todo \(5 · \$29,950\)$/,
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fixed-derived-planilla")).toBeTruthy()
    );
    expect(screen.getByTestId("fixed-derived-planilla").textContent).toContain(
      "$20,000"
    );
    expect(screen.getByTestId("fixed-derived-alquiler").textContent).toContain(
      "$7,000"
    );
    expect(screen.getByTestId("fixed-derived-servicios").textContent).toContain(
      "$2,450"
    );
    expect(screen.getByTestId("fixed-derived-otros").textContent).toContain(
      "$500"
    );
    expect(screen.getByTestId("fixed-total").textContent).toContain("$29,950");
    // The break-even now has a number (all four amounts are in).
    expect(screen.getAllByTestId("break-even-value")[0].textContent).toMatch(
      /\$/
    );
    expect(screen.getAllByTestId("break-even")[0].textContent).not.toContain(
      "Falta"
    );
    expect(clicks).toBeLessThanOrEqual(3);
    // No page reload right away, no modal.
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The lines moved into «Aprobadas (n)» under their clusters, not gone.
    expect(screen.getByTestId("approved-servicios").textContent).toContain(
      "Aprobadas (2)"
    );
    expect(screen.getByTestId("approved-servicios").textContent).toContain(
      "Agua demo"
    );
    expect(screen.queryAllByTestId("upload-line")).toHaveLength(0);
    // The changed cluster and the break-even flash in the app blue.
    expect(screen.getByTestId("fixed-row-servicios").className).toContain(
      "#E7EDFD"
    );
    expect(screen.getAllByTestId("break-even")[0].className).toContain(
      "#1B40C8"
    );
  });

  it("skips ⚑ Falta lines: they stay at the top and are not in the count or the sum", async () => {
    show([...FIVE, mk("l6", "Cosa rara", null, null)]);
    expect(await screen.findByTestId("fix-first")).toBeTruthy();
    const allBtn = screen.getByRole("button", { name: /^Aprobar todo/ });
    expect(allBtn.textContent).toBe("Aprobar todo (5 · $29,950)");
    fireEvent.click(allBtn);
    await waitFor(() =>
      expect(screen.getByTestId("fixed-derived-planilla")).toBeTruthy()
    );
    const rows = screen.getAllByTestId("upload-line");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Cosa rara");
    expect(within(rows[0]).getAllByText(/Falta/).length).toBeGreaterThan(0);
    expect(
      (
        within(rows[0]).getByRole("button", {
          name: "Aprobar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

describe("one at a time", () => {
  it("shows «Agua +$650 → Servicios» with Deshacer; the second line adds to the first", async () => {
    show([FIVE[2], FIVE[3]]);
    fireEvent.click(
      within(await lineRow("Luz demo")).getByRole("button", { name: "Aprobar" })
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("fixed-derived-servicios").textContent
      ).toContain("$1,800")
    );
    fireEvent.click(
      within(await lineRow("Agua demo")).getByRole("button", {
        name: "Aprobar",
      })
    );
    expect((await screen.findByTestId("approve-toast")).textContent).toContain(
      "Agua demo +$650 → Servicios"
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("fixed-derived-servicios").textContent
      ).toContain("$2,450")
    );
    expect(screen.getByTestId("approved-servicios").textContent).toContain(
      "Aprobadas (2)"
    );
  });

  it("Deshacer puts the cluster and the line back", async () => {
    show([FIVE[2], FIVE[3]]);
    fireEvent.click(
      within(await lineRow("Luz demo")).getByRole("button", { name: "Aprobar" })
    );
    fireEvent.click(
      within(await lineRow("Agua demo")).getByRole("button", {
        name: "Aprobar",
      })
    );
    const undo = await screen.findByRole("button", { name: "Deshacer" });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(
        screen.getByTestId("fixed-derived-servicios").textContent
      ).toContain("$1,800")
    );
    expect(await lineRow("Agua demo")).toBeTruthy();
    expect(server.calls).toContain("undo");
    expect(screen.getByTestId("approve-toast").textContent).toContain(
      "Deshecho"
    );
  });

  it("the toast goes away by itself after about 5 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show([FIVE[3]]);
      fireEvent.click(
        within(await lineRow("Agua demo")).getByRole("button", {
          name: "Aprobar",
        })
      );
      await screen.findByTestId("approve-toast");
      await act(async () => {
        vi.advanceTimersByTime(5200);
      });
      expect(screen.queryByTestId("approve-toast")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a failed save", () => {
  it("rolls back: the line is pending again, the field is untouched, a message says so", async () => {
    show([FIVE[3]]);
    server.failApprove = true;
    fireEvent.click(
      within(await lineRow("Agua demo")).getByRole("button", {
        name: "Aprobar",
      })
    );
    expect(await screen.findByText(/Deshice el cambio/)).toBeTruthy();
    expect(screen.queryByTestId("fixed-derived-servicios")).toBeNull();
    expect(
      (document.getElementById("fixed-servicios") as HTMLInputElement).value
    ).toBe("");
    expect(await lineRow("Agua demo")).toBeTruthy();
    expect(screen.queryByTestId("approve-toast")).toBeNull();
  });
});

describe("last month", () => {
  const lm = { planilla: 10000, alquiler: 7000 };
  it("small grey text per line, and the tag only above 20%", async () => {
    show([FIVE[0], FIVE[1]], view({ lastMonth: lm }));
    const planilla = await lineRow("Nómina demo");
    expect(planilla.textContent).toContain("Mes pasado: $10,000");
    // 20,000 vs 10,000 = +100%: tagged; 7,000 vs 7,000: nothing.
    expect(screen.getByTestId("change-planilla").textContent).toContain(
      "+100%"
    );
    expect(screen.queryByTestId("change-alquiler")).toBeNull();
  });
  it("a 15% change is not flagged", async () => {
    show([mk("x", "Nómina demo", "planilla", 11500)], view({ lastMonth: lm }));
    await lineRow("Nómina demo");
    expect(screen.queryByTestId("change-planilla")).toBeNull();
  });
  it("the tag is a small Amarillo tag, never a yellow box", async () => {
    show([FIVE[0]], view({ lastMonth: lm }));
    const tag = await screen.findByTestId("change-planilla");
    expect(tag.className).toContain("rounded-full");
  });
});

describe("totals come from the lines", () => {
  const upload = (category: string, amount: number, label: string) => ({
    location_id: LOC,
    month: MONTH,
    category,
    label,
    amount,
    pct_of_sales: null,
    currency: "USD",
    source: "upload",
    status: "confirmed",
    repeats: false,
    split_rule: null,
  });
  it("a cluster saved from a file is a read-only total; «Editar a mano» unlocks a typed value", async () => {
    show([], view({ lines: [upload("servicios", 2450, "Luz + Agua")] }));
    const row = screen.getByTestId("fixed-derived-servicios");
    expect(row.textContent).toContain("$2,450");
    expect(document.getElementById("fixed-servicios")?.tagName).not.toBe(
      "INPUT"
    );
    fireEvent.click(within(row).getByRole("button", { name: "Editar a mano" }));
    expect(
      (document.getElementById("fixed-servicios") as HTMLInputElement).value
    ).toBe("2450");
  });
  it("a cluster with no line keeps the manual field", () => {
    show([], view());
    expect(document.getElementById("fixed-servicios")?.tagName).toBe("INPUT");
  });
});
