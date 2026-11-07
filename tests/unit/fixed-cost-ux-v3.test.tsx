// @vitest-environment jsdom
// Fixed-cost upload UX v3 (Sofia's mocks; release blocker). One source of truth on
// screen: the confirmed amount of each cluster card. ✓ Aprobar moves the amount
// into its card at once (no accordion, no reload, no second empty field), the
// Costos fijos total and the break-even move with it, «Deshacer» puts it back,
// a failed save says so on that line. A tiny fake server mirrors the real rules
// (same-category lines add up; Reemplazar replaces; Sumar adds). Demo data only.
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
  amount: number | null,
  scope: unknown = { kind: "restaurant", locationId: LOC }
) => ({
  id,
  raw,
  category,
  amount,
  month: MONTH,
  scope,
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
  puts: any[];
  patches: any[];
  failApprove: boolean;
  /** Line ids the server refuses to save (they stay pending, with an issue). */
  refuse: string[];
  confirmed: Record<string, number>;
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
      const issues = ids
        .filter((id) => server.refuse.includes(id))
        .map((lineId) => ({ lineId, error: "no se pudo" }));
      const picked = ids
        .filter((id) => !server.refuse.includes(id))
        .map((id) => server.draft.lines.find((x) => x.id === id));
      const applied: any[] = [];
      for (const l of picked) l.status = "approved";
      const cats = [...new Set(picked.map((l) => l.category))];
      for (const c of cats) {
        const mine = picked.filter((l) => l.category === c);
        const sum = mine.reduce((n, x) => n + x.amount, 0);
        const own = server.draft.lines
          .filter((x) => x.status === "approved" && x.category === c)
          .reduce((n, x) => n + x.amount, 0);
        const total = body.adds
          ? (server.confirmed[c] ?? 0) + sum
          : body.confirmed
            ? sum
            : own;
        const previous =
          c in server.confirmed
            ? {
                amount: server.confirmed[c],
                pct_of_sales: null,
                label: null,
                source: "upload",
              }
            : null;
        server.confirmed[c] = total;
        applied.push({
          category: c,
          month: MONTH,
          locationId: LOC,
          total,
          previous,
          repeats: !mine.some((l) => l.oneTime),
          lineIds: mine.map((l) => l.id),
        });
      }
      return json({
        approved: applied.length,
        issues,
        applied,
        draft: structuredClone(server.draft),
      });
    }
    if (u.endsWith("/undo")) {
      server.calls.push("undo");
      for (const a of body.applied) {
        for (const id of a.lineIds)
          server.draft.lines.find((x) => x.id === id).status = "pending";
        if (a.previous) server.confirmed[a.category] = a.previous.amount;
        else delete server.confirmed[a.category];
      }
      return json({ draft: structuredClone(server.draft) });
    }
    if (u.endsWith("/api/restaurant/fixed-costs") && init?.method === "PUT") {
      server.puts.push(body);
      return json({ lines: [] });
    }
    if (init?.method === "PATCH") {
      server.calls.push("patch");
      server.patches.push(body);
      for (const e of body.edits ?? []) {
        const l = server.draft.lines.find((x) => x.id === e.lineId);
        if (e.discard) l.status = "discarded";
        if (e.category !== undefined) l.category = e.category;
        if (e.amount !== undefined) l.amount = e.amount;
        if (e.scope !== undefined) l.scope = e.scope;
      }
      return json({ draft: structuredClone(server.draft) });
    }
    return json({ draft: structuredClone(server.draft) });
  });
}

const saved = (category: string, amount: number, source = "upload") => ({
  location_id: LOC,
  month: MONTH,
  category,
  label: null,
  amount: category === "impuestos" ? null : amount,
  pct_of_sales: category === "impuestos" ? amount : null,
  currency: "USD",
  source,
  status: "confirmed",
  repeats: false,
  split_rule: null,
});

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
function show(
  lines: any[] = FIVE,
  v = view(),
  savedItems?: Record<string, any[]>,
  history: any[] = []
) {
  server = {
    draft: {
      id: "d1",
      fileName: "costos-demo.csv",
      status: "draft",
      lines: structuredClone(lines),
    },
    calls: [],
    puts: [],
    patches: [],
    failApprove: false,
    refuse: [],
    confirmed: {},
  };
  for (const l of (v as any).lines)
    server.confirmed[l.category] = l.amount ?? l.pct_of_sales;
  installFetch();
  render(
    <FixedCostsTab
      view={v}
      history={history}
      savedItems={savedItems}
      locationName="Demo"
      shellParams={{}}
      currentMonth={MONTH}
      restaurants={[{ id: LOC, name: "Demo" }]}
    />
  );
}
const lineRow = async (name: string) =>
  (await screen.findAllByTestId("upload-line")).find((r) =>
    r.textContent?.includes(name)
  )!;
const approveBtn = async (name: string) =>
  within(await lineRow(name)).getByRole("button", { name: "Aprobar" });
const card = (c: string) => screen.getByTestId(`fixed-row-${c}`);
const beValue = () =>
  screen.queryAllByTestId("break-even-value")[0]?.textContent ?? null;

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("before any upload (the empty mock)", () => {
  it("every cluster is «Sin dato · subir factura o escribir» with Subir / Escribir; no amount, no field", () => {
    show();
    for (const c of [
      "planilla",
      "alquiler",
      "servicios",
      "impuestos",
      "otros",
    ]) {
      expect(card(c).getAttribute("data-state")).toBe("empty");
      expect(card(c).querySelectorAll("input")).toHaveLength(0);
      expect(card(c).textContent).toContain(
        "Sin dato · subir factura o escribir"
      );
      expect(
        within(card(c)).getByRole("button", { name: "Subir" })
      ).toBeTruthy();
      expect(
        within(card(c)).getByRole("button", { name: /^Escribir/ })
      ).toBeTruthy();
      expect(card(c).textContent).not.toMatch(/\$\d/);
    }
  });

  it("the wide drop zone: «Suelta una factura o PDF» + «Subir factura»", () => {
    show();
    expect(screen.getByText("Suelta una factura o PDF")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "⇪ Subir factura" })
    ).toBeTruthy();
    expect(
      screen.getByText(/Sube una factura o escribe el monto/)
    ).toBeTruthy();
  });

  it("no confirmed cost: no break-even dollars, only the invitation; nothing confirmed", () => {
    show();
    expect(beValue()).toBeNull();
    const be = screen.getAllByTestId("break-even")[0];
    expect(be.textContent).toContain("Con estos costos, necesitas vender");
    expect(be.textContent).toContain("—");
    expect(be.textContent).toContain("al día");
    expect(screen.getByTestId("break-even-empty").textContent).toBe(
      "Añade costos fijos para ver el punto de equilibrio"
    );
    expect(screen.getByTestId("confirmed-count").textContent).toBe("0 de 5");
    // «Total costos fijos» is «—» with nothing confirmed, never $0
    expect(screen.getByTestId("fixed-total").textContent).not.toContain("$");
    expect(screen.queryByTestId("confirmed-pill")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Aprobar todo/ })).toBeNull();
  });
});

describe("root cause: one source of truth", () => {
  it("approving a line turns the empty card into the amount; the field and «Sin dato» go away", async () => {
    show([FIVE[3]]);
    fireEvent.click(await approveBtn("Agua demo"));
    await waitFor(() =>
      expect(card("servicios").getAttribute("data-state")).toBe("confirmed")
    );
    const c = card("servicios");
    expect(c.textContent).toContain("$650");
    expect(c.textContent).toContain("Agua demo · desde factura");
    expect(c.textContent).toContain("Editar");
    expect(c.querySelectorAll("input[type=text]")).toHaveLength(0);
    expect(c.textContent).not.toContain("Sin dato");
    expect(screen.getByTestId("fixed-total").textContent).toContain("$650");
  });

  it("the break-even moves after EVERY approval that changes the total", async () => {
    show([FIVE[0], FIVE[1], FIVE[2], FIVE[3], FIVE[4]]);
    const seen: Array<string | null> = [beValue()];
    for (const name of ["Nómina demo", "Renta demo", "Luz demo", "Agua demo"]) {
      fireEvent.click(await approveBtn(name));
      await waitFor(() => expect(beValue()).not.toBe(seen[seen.length - 1]));
      seen.push(beValue());
    }
    expect(seen[0]).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    // Break-even = confirmed ÷ (margin % × open days): 29,450 ÷ (0.7 × 30).
    expect(seen[4]).toBe("$1,402");
    expect(screen.getByTestId("fixed-total").textContent).toContain("$29,450");
  });

  it("with some clusters still missing it still moves, and says how many are confirmed", async () => {
    show([FIVE[0]]);
    fireEvent.click(await approveBtn("Nómina demo"));
    await waitFor(() => expect(beValue()).not.toBeNull());
    expect(screen.getByTestId("confirmed-count").textContent).toBe("1 de 5");
    expect(screen.getByTestId("confirmed-pill").textContent).toBe(
      "Categorías confirmadas: 1 de 5"
    );
  });
});

describe("5 lines → Aprobar todo", () => {
  it("all 5 amounts on their cards, exact total, break-even moved, ≤3 clicks, no reload, no accordion", async () => {
    show();
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
      expect(card("planilla").getAttribute("data-state")).toBe("confirmed")
    );
    expect(card("planilla").textContent).toContain("$20,000");
    expect(card("alquiler").textContent).toContain("$7,000");
    expect(card("servicios").textContent).toContain("$2,450");
    expect(card("otros").textContent).toContain("$500");
    expect(screen.getByTestId("fixed-total").textContent).toContain("$29,950");
    expect(beValue()).toMatch(/\$/);
    // «desde $29,950 costos fijos · 30 días abiertos»: the exact sum of the cards
    expect(screen.getByTestId("break-even-detail").textContent).toBe(
      "desde $29,950 costos fijos · 30 días abiertos"
    );
    // Servicios lists its lines under the card; the card is their sum
    const items = screen.getByTestId("fixed-items-servicios");
    expect(items.textContent).toContain("Luz demo");
    expect(items.textContent).toContain("$650");
    expect(items.textContent).toContain("$1,800");
    expect(clicks).toBeLessThanOrEqual(3);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("confirmed-pill").textContent).toBe(
      "Categorías confirmadas: 4 de 5"
    );
    // No accordion, no «Aprobadas (n)», nothing to expand; the review is done.
    expect(document.querySelectorAll("details")).toHaveLength(0);
    expect(screen.queryByText(/Aprobadas/)).toBeNull();
    expect(screen.queryAllByTestId("upload-line")).toHaveLength(0);
    // The button is gone, never «Aprobar todo (0 · $0)».
    expect(screen.queryByRole("button", { name: /^Aprobar todo/ })).toBeNull();
    // The changed card and the break-even flash in the app blue only.
    expect(card("servicios").className).toContain("#E7EDFD");
    expect(screen.getAllByTestId("break-even")[0].className).toContain(
      "#1B40C8"
    );
  });

  it("skips ⚑ Falta lines: they stay at the top, with what is missing, out of the count and the sum", async () => {
    show([...FIVE, mk("l6", "Cosa rara", null, null)]);
    const rows = await screen.findAllByTestId("upload-line");
    expect(rows[0].textContent).toContain("Cosa rara");
    expect(rows[0].textContent).toContain("Falta · ¿A qué grupo?");
    const allBtn = screen.getByRole("button", { name: /^Aprobar todo/ });
    expect(allBtn.textContent).toBe("Aprobar todo (5 · $29,950)");
    fireEvent.click(allBtn);
    await waitFor(() =>
      expect(card("planilla").getAttribute("data-state")).toBe("confirmed")
    );
    const left = screen.getAllByTestId("upload-line");
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain("Cosa rara");
    expect(
      within(left[0]).queryByRole("button", { name: "Aprobar" })
    ).toBeNull();
  });
});

describe("one at a time", () => {
  it("shows «Agua demo +$650 → Servicios» with Deshacer; the second line adds to the first", async () => {
    show([FIVE[2], FIVE[3]]);
    fireEvent.click(await approveBtn("Luz demo"));
    await waitFor(() =>
      expect(card("servicios").textContent).toContain("$1,800")
    );
    fireEvent.click(await approveBtn("Agua demo"));
    expect((await screen.findByTestId("approve-toast")).textContent).toContain(
      "Agua demo +$650 → Servicios"
    );
    await waitFor(() =>
      expect(card("servicios").textContent).toContain("$2,450")
    );
  });

  it("Deshacer puts the card and the line back", async () => {
    show([FIVE[2], FIVE[3]]);
    fireEvent.click(await approveBtn("Luz demo"));
    fireEvent.click(await approveBtn("Agua demo"));
    fireEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(card("servicios").textContent).toContain("$1,800")
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
      fireEvent.click(await approveBtn("Agua demo"));
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

describe("✓ Aprobar never no-ops", () => {
  it("a failed save puts the line back, leaves the card empty and says so ON THAT LINE", async () => {
    show([FIVE[3]]);
    server.failApprove = true;
    fireEvent.click(await approveBtn("Agua demo"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("upload-line")).getByRole("alert").textContent
      ).toContain("boom")
    );
    expect(card("servicios").getAttribute("data-state")).toBe("empty");
    expect(screen.queryByTestId("approve-toast")).toBeNull();
    expect(beValue()).toBeNull();
  });
});

describe("«vs mes pasado»", () => {
  it("small grey text on the line, whatever the size of the change", async () => {
    show(
      [FIVE[0], FIVE[1]],
      view({ lastMonth: { planilla: 10000, alquiler: 7000 } })
    );
    const planilla = await lineRow("Nómina demo");
    expect(planilla.textContent).toContain("vs mes pasado: +100%");
    expect((await lineRow("Renta demo")).textContent).toContain(
      "vs mes pasado: 0%"
    );
    const small = within(planilla).getByText(/vs mes pasado/);
    expect(small.className).toContain("text-[#6b7385]");
  });
  it("nothing when last month is unknown", async () => {
    show([FIVE[0]]);
    expect((await lineRow("Nómina demo")).textContent).not.toContain(
      "vs mes pasado"
    );
  });
});

describe("manual entry and editing on the card", () => {
  it("«Escribir» opens ONE field; saving makes it the card and the field goes away", async () => {
    show([]);
    fireEvent.click(screen.getByRole("button", { name: "Escribir Alquiler" }));
    fireEvent.change(screen.getByLabelText("Monto de Alquiler"), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Alquiler" }));
    await waitFor(() =>
      expect(card("alquiler").getAttribute("data-state")).toBe("confirmed")
    );
    expect(card("alquiler").textContent).toContain("$1,200");
    expect(card("alquiler").textContent).toContain("escrito a mano");
    expect(card("alquiler").querySelectorAll("input[type=text]")).toHaveLength(
      0
    );
    // One entry only: the other clusters are never touched by this save.
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].entries).toHaveLength(1);
    expect(server.puts[0].entries[0]).toMatchObject({
      category: "alquiler",
      value: 1200,
    });
    expect(screen.getByTestId("fixed-total").textContent).toContain("$1,200");
    // the drop zone is gone: something is confirmed now
    expect(screen.queryByText("Suelta una factura o PDF")).toBeNull();
  });

  it("an amount that is not a number is not saved", () => {
    show([]);
    fireEvent.click(screen.getByRole("button", { name: "Escribir Alquiler" }));
    fireEvent.change(screen.getByLabelText("Monto de Alquiler"), {
      target: { value: "12x" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar Alquiler",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("Editar is inline on the card and replaces the amount", async () => {
    show([], view({ lines: [saved("planilla", 21400)] }));
    expect(card("planilla").textContent).toContain("$21,400");
    expect(card("planilla").textContent).toContain("desde factura");
    fireEvent.click(screen.getByRole("button", { name: "Editar Planilla" }));
    const field = screen.getByLabelText(
      "Monto de Planilla"
    ) as HTMLInputElement;
    expect(field.value).toBe("21400");
    fireEvent.change(field, { target: { value: "22000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Planilla" }));
    await waitFor(() =>
      expect(card("planilla").textContent).toContain("$22,000")
    );
    expect(card("planilla").textContent).toContain("escrito a mano");
    expect(server.puts[0].entries[0]).toMatchObject({
      category: "planilla",
      value: 22000,
    });
  });

  it("«Se repite cada mes» saves that cluster only and keeps «desde factura»", async () => {
    show([], view({ lines: [saved("planilla", 21400)] }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Se repite cada mes: Planilla" })
    );
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].entries).toHaveLength(1);
    expect(server.puts[0].entries[0]).toMatchObject({
      category: "planilla",
      value: 21400,
      repeats: true,
      keepSource: true,
    });
    expect(card("planilla").textContent).toContain("desde factura");
  });
});

describe("Copiar mes", () => {
  it("only when something is confirmed; says what it did", async () => {
    show([]);
    expect(screen.queryByRole("button", { name: /^Copiar/ })).toBeNull();
    cleanup();
    show([], view({ lines: [saved("planilla", 21400)] }));
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar recurrentes de septiembre" })
    );
    expect(
      await screen.findByText(
        /No hay costos recurrentes que copiar de septiembre/
      )
    ).toBeTruthy();
  });
});

describe("group share on a restaurant", () => {
  const withShare = () =>
    view({
      lines: [saved("planilla", 1000)],
      groupShares: { servicios: 500, otros: 50 },
      groupImpuestosPct: 10,
    });

  it("one read-only row «Compartidos del grupo · $550»; Total = cards + share; «desde $Y» = Total", () => {
    show([], withShare());
    const row = screen.getByTestId("fixed-shared-row");
    expect(row.textContent).toContain("Compartidos del grupo · $550");
    expect(row.textContent).toContain("tu parte · no se edita aquí");
    expect(row.querySelectorAll("input,button")).toHaveLength(0);
    expect(screen.getByTestId("fixed-total").textContent).toContain("$1,550");
    expect(screen.getByTestId("break-even-detail").textContent).toContain(
      "desde $1,550 costos fijos"
    );
    // «Más $X del grupo» never comes back under an empty field
    expect(document.body.textContent).not.toMatch(/Más .* del grupo/);
    expect(card("servicios").getAttribute("data-state")).toBe("empty");
    expect(card("servicios").textContent).not.toContain("$500");
  });

  it("the break-even includes the group share and the inherited tax rate (same as Rentabilidad)", () => {
    show([], withShare());
    const cm = (100000 - (100000 * 0.1) / 1.1 - 30000) / 100000;
    const expected = (1550 / (cm * 30)).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    expect(beValue()).toBe(`$${expected}`);
  });

  it("without a share there is no row; and the group view never has one", () => {
    show([], view({ lines: [saved("planilla", 1000)] }));
    expect(screen.queryByTestId("fixed-shared-row")).toBeNull();
    cleanup();
    show(
      [],
      view({
        locationId: null,
        lines: [],
        groupShares: { servicios: 500 },
      })
    );
    expect(screen.queryByTestId("fixed-shared-row")).toBeNull();
  });
});

describe("v3 answers from Sofia", () => {
  it("«Categorías confirmadas: N de M» is mint with Ink text", async () => {
    show([FIVE[0]]);
    fireEvent.click(await approveBtn("Nómina demo"));
    const pill = await screen.findByTestId("confirmed-pill");
    expect(pill.className).toContain("bg-[#A7F3D0]");
    expect(pill.className).toContain("text-[#0F172A]");
  });

  it("an approved bill's «Se repite cada mes» is ON; a one-off's is OFF", async () => {
    show([FIVE[0], { ...FIVE[1], oneTime: true }]);
    fireEvent.click(await approveBtn("Nómina demo"));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("switch", {
            name: "Se repite cada mes: Planilla",
          }) as HTMLInputElement
        ).checked
      ).toBe(true)
    );
    fireEvent.click(await approveBtn("Renta demo"));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("switch", {
            name: "Se repite cada mes: Alquiler",
          }) as HTMLInputElement
        ).checked
      ).toBe(false)
    );
  });

  it("after a reload the lines saved by an earlier upload still list under the card", () => {
    show(
      [],
      view({
        lines: [{ ...saved("servicios", 3900), label: "Agua + Seguro" }],
      }),
      {
        servicios: [
          { id: "a", raw: "Agua", amount: 650 },
          { id: "b", raw: "Seguro", amount: 3250 },
        ],
      }
    );
    const items = screen.getByTestId("fixed-items-servicios");
    expect(items.textContent).toContain("Agua");
    expect(items.textContent).toContain("$650");
    expect(items.textContent).toContain("Seguro");
    expect(items.textContent).toContain("$3,250");
  });

  it("saved lines that no longer add up to the card are not shown", () => {
    show([], view({ lines: [saved("servicios", 4000)] }), {
      servicios: [
        { id: "a", raw: "Agua", amount: 650 },
        { id: "b", raw: "Seguro", amount: 3250 },
      ],
    });
    expect(screen.queryByTestId("fixed-items-servicios")).toBeNull();
  });

  it("Historial: category · change · source, with a relative time", () => {
    const now = new Date().toISOString();
    show([], view({ lines: [saved("servicios", 650)] }), undefined, [
      {
        id: "h1",
        created_at: now,
        actor: null,
        action: "update",
        category: "servicios",
        month: MONTH,
        location_id: LOC,
        old_value: { amount: 0, pct_of_sales: null },
        new_value: { amount: 650, pct_of_sales: null },
        source: "upload",
      },
    ]);
    const h = screen.getByTestId("history");
    expect(h.textContent).toContain("Servicios · +$650 · desde factura");
    expect(h.textContent).toMatch(/minuto|hace/);
  });
});

describe("when data already exists", () => {
  const planilla = () => view({ lines: [saved("planilla", 21400, "manual")] });
  const proposal = [mk("p", "Nómina demo", "planilla", 22100)];

  it("Reemplazar: the card becomes the invoice amount", async () => {
    show(proposal, planilla());
    const row = await lineRow("Nómina demo");
    expect(within(row).getByTestId("line-diff").textContent).toBe(
      "Planilla hoy $21,400 · la factura propone $22,100"
    );
    fireEvent.click(within(row).getByRole("button", { name: "Reemplazar" }));
    await waitFor(() =>
      expect(card("planilla").textContent).toContain("$22,100")
    );
    expect(card("planilla").textContent).not.toContain("$43,500");
  });

  it("Sumar: the card becomes today + the invoice", async () => {
    show(proposal, planilla());
    const row = await lineRow("Nómina demo");
    fireEvent.click(
      within(row).getByRole("button", { name: "Sumar (→ $43,500)" })
    );
    await waitFor(() =>
      expect(card("planilla").textContent).toContain("$43,500")
    );
    expect(screen.getByTestId("fixed-total").textContent).toContain("$43,500");
  });

  it("«Aprobar todo» does not touch it without a choice", async () => {
    show([...proposal, FIVE[1]], planilla());
    const all = await screen.findByRole("button", { name: /^Aprobar todo/ });
    expect(all.textContent).toBe("Aprobar todo (1 · $7,000)");
    fireEvent.click(all);
    await waitFor(() =>
      expect(card("alquiler").getAttribute("data-state")).toBe("confirmed")
    );
    expect(card("planilla").textContent).toContain("$21,400");
    expect((await lineRow("Nómina demo")).getAttribute("data-status")).toBe(
      "diff"
    );
  });
});

describe("Falta copy always says what is missing", () => {
  it("unknown restaurant: «Falta · ¿A qué restaurante?» with the picker, never a bare flag", async () => {
    show([mk("g", "Gas · Sucursal Inventada", "otros", 900, null)]);
    const row = await lineRow("Sucursal Inventada");
    expect(row.textContent).toContain("Falta · ¿A qué restaurante?");
    expect((await screen.findByTestId("falta-pill")).textContent).toContain(
      "Falta · Gas"
    );
    fireEvent.click(within(row).getByRole("button", { name: "Asignar" }));
    fireEvent.change(within(row).getByLabelText("¿A qué restaurante?"), {
      target: { value: LOC },
    });
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0].edits[0].scope).toEqual({
      kind: "restaurant",
      locationId: LOC,
    });
    // Answered: now it is an ordinary line that can be approved.
    const fixed = await lineRow("Sucursal Inventada");
    expect(fixed.getAttribute("data-status")).toBe("ready");
  });
});

describe("a batch where the server saves only some lines", () => {
  it("only the saved cluster is confirmed; the refused one goes back and says so on its line", async () => {
    show([FIVE[0], FIVE[1]]);
    server.refuse = ["l2"]; // Renta demo is refused
    fireEvent.click(
      await screen.findByRole("button", { name: /^Aprobar todo/ })
    );
    await waitFor(() =>
      expect(card("planilla").getAttribute("data-state")).toBe("confirmed")
    );
    // The refused cluster is back to its pre-approve state, never a confirmed
    // card next to a pending line.
    await waitFor(() =>
      expect(card("alquiler").getAttribute("data-state")).toBe("empty")
    );
    expect(card("alquiler").querySelectorAll("input")).toHaveLength(0);
    expect(
      within(card("alquiler")).getByRole("button", { name: /^Escribir/ })
    ).toBeTruthy();
    expect(card("planilla").textContent).toContain("$20,000");
    expect(screen.getByTestId("fixed-total").textContent).toContain("$20,000");
    const left = await lineRow("Renta demo");
    expect(within(left).getByRole("alert").textContent).toContain("no se pudo");
  });

  it("a refused line in a cluster that already had a value restores that value", async () => {
    show([FIVE[1]], view({ lines: [saved("alquiler", 7000, "upload")] }));
    // the same amount is not a diff; the server still refuses it
    server.refuse = ["l2"];
    fireEvent.click(await approveBtn("Renta demo"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("upload-line")).getByRole("alert")
      ).toBeTruthy()
    );
    expect(card("alquiler").textContent).toContain("$7,000");
    expect(card("alquiler").getAttribute("data-state")).toBe("confirmed");
    expect(screen.queryByTestId("approve-toast")).toBeNull();
  });
});
