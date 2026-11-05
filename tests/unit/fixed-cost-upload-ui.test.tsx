// @vitest-environment jsdom
// Costos fijos: «⇪ Subir archivo» is visible straight away; the inline review
// says exactly what is missing on a line Milton could not place (never a bare
// ⚑), keeps the lavender tag for AI lines, shows the diff against a confirmed
// amount and lets the person replace or add. Demo data only.
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
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

import { FixedCostUpload } from "@/components/restaurant/costs/FixedCostUpload";
import type { ClusterMap } from "@/lib/restaurant/fixed-cost-clusters";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOC = "00000000-0000-4000-8000-00000000000a";
const draft = {
  id: "d1",
  fileName: "costos-demo.pdf",
  status: "draft",
  lines: [
    {
      id: "l1",
      raw: "Renta del local",
      category: "alquiler",
      amount: 7000,
      month: "2026-10-01",
      scope: { kind: "restaurant", locationId: LOC },
      from: "ai",
      status: "pending",
    },
    {
      id: "l2",
      raw: "Concepto raro",
      category: null,
      amount: null,
      month: "2026-10-01",
      scope: { kind: "restaurant", locationId: LOC },
      from: "file",
      status: "pending",
    },
  ],
};

function show(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  clusters: ClusterMap = {}
) {
  vi.stubGlobal("fetch", fetcher);
  render(
    <FixedCostUpload
      month="2026-10-01"
      locationId={LOC}
      currency="USD"
      restaurants={[{ id: LOC, name: "Sucursal Demo Norte" }]}
      clusters={clusters}
    />
  );
}
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
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
  month: "2026-10-01",
  scope,
  from: "file",
  status: "pending",
});
const withLines = (lines: unknown[]) => ({ ...draft, lines });

describe("FixedCostUpload", () => {
  it("shows the drop zone and its button right away, no tab or menu", () => {
    show(async () => ok({ draft: null }));
    expect(screen.getByText("Suelta una factura o PDF")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "⇪ Subir factura" })
    ).toBeTruthy();
  });

  it("a line Milton could not place says what is missing and has no ✓; ⚑ Falta stays on top", async () => {
    show(async () => ok({ draft }));
    const lines = await screen.findAllByTestId("upload-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute("data-status")).toBe("falta");
    expect(within(lines[0]).getByTestId("falta-tag").textContent).toContain(
      "Falta · ¿A qué grupo?"
    );
    expect(within(lines[0]).queryByRole("button", { name: "Aprobar" })).toBe(
      null
    );
    expect(
      within(lines[0]).getByRole("button", { name: "Asignar" })
    ).toBeTruthy();
    expect(
      within(lines[0]).getByRole("button", { name: "Omitir" })
    ).toBeTruthy();
    expect(within(lines[1]).getByText("Leído por Milton").className).toContain(
      "#DDD6FE"
    );
    expect(screen.getByText(/Nada cambia en tus costos fijos/)).toBeTruthy();
  });

  it("an unknown restaurant asks «¿A qué restaurante?» and lets you answer it", async () => {
    const edits: unknown[] = [];
    show(async (_url, init) => {
      if (init?.method === "PATCH") {
        edits.push(JSON.parse(String(init.body)));
        return ok({
          draft: withLines([mk("g", "Gas · Sucursal Inventada", "otros", 900)]),
        });
      }
      return ok({
        draft: withLines([
          mk("g", "Gas · Sucursal Inventada", "otros", 900, null),
        ]),
      });
    });
    const row = await screen.findByTestId("upload-line");
    expect(row.textContent).toContain("Falta · ¿A qué restaurante?");
    expect(within(row).queryByRole("button", { name: "Aprobar" })).toBe(null);
    fireEvent.click(within(row).getByRole("button", { name: "Asignar" }));
    fireEvent.change(within(row).getByLabelText("¿A qué restaurante?"), {
      target: { value: LOC },
    });
    await waitFor(() => expect(edits).toHaveLength(1));
    expect((edits[0] as any).edits[0]).toMatchObject({
      lineId: "g",
      scope: { kind: "restaurant", locationId: LOC },
    });
  });

  it("«Aprobar todo» counts only what can be approved, and is hidden at 0", async () => {
    show(async () => ok({ draft }));
    await screen.findAllByTestId("upload-line");
    expect(
      screen.getByRole("button", { name: "Aprobar todo (1 · $7,000)" })
    ).toBeTruthy();
    cleanup();
    show(async () => ok({ draft: withLines([mk("x", "Raro", null, null)]) }));
    await screen.findAllByTestId("upload-line");
    expect(screen.queryByRole("button", { name: /^Aprobar todo/ })).toBe(null);
  });

  it("an overwrite the server finds that we did not foresee still asks: old → new", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    show(async (url, init) => {
      if (init?.method === "POST") {
        const body = String(init.body);
        calls.push({ url, body });
        return JSON.parse(body).confirmed
          ? ok({
              approved: 1,
              applied: [],
              draft: { ...draft, status: "draft", lines: [draft.lines[1]] },
            })
          : ok(
              {
                conflicts: [
                  {
                    lineId: "l1",
                    category: "alquiler",
                    month: "2026-10-01",
                    old: 6500,
                    new: 7000,
                  },
                ],
              },
              409
            );
      }
      return ok({ draft });
    });
    await screen.findAllByTestId("upload-line");
    fireEvent.click(screen.getByRole("button", { name: /^Aprobar todo/ }));
    const panel = await screen.findByTestId("overwrite-confirm");
    expect(panel.textContent).toContain("$6,500 → $7,000");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Reemplazar y aprobar" })
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(calls[1].body).confirmed).toEqual(["l1"]);
  });
});

describe("a cluster that already has a confirmed amount", () => {
  const planilla = { value: 21400, source: "manual", label: null };
  const lineSet = () => withLines([mk("p", "Nómina demo", "planilla", 22100)]);

  it("shows the diff and asks replace or add; «Aprobar todo» is hidden", async () => {
    show(async () => ok({ draft: lineSet() }), { planilla });
    const row = await screen.findByTestId("upload-line");
    expect(row.getAttribute("data-status")).toBe("diff");
    expect(within(row).getByTestId("line-diff").textContent).toBe(
      "Planilla hoy $21,400 · la factura propone $22,100"
    );
    expect(
      within(row).getByRole("button", { name: "Reemplazar" })
    ).toBeTruthy();
    expect(
      within(row).getByRole("button", { name: "Sumar (→ $43,500)" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Aprobar todo/ })).toBe(null);
    expect(screen.getByText(/1 líneas esperan tu decisión/)).toBeTruthy();
  });

  it.each([
    ["Reemplazar", "confirmed"],
    ["Sumar (→ $43,500)", "adds"],
  ])("«%s» sends %s for that line", async (name, key) => {
    let sent: any = null;
    show(
      async (_u, init) => {
        if (init?.method === "POST") {
          sent = JSON.parse(String(init.body));
          return ok({ approved: 1, applied: [], draft: lineSet() });
        }
        return ok({ draft: lineSet() });
      },
      { planilla }
    );
    const row = await screen.findByTestId("upload-line");
    fireEvent.click(within(row).getByRole("button", { name }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent[key]).toEqual(["p"]);
  });

  it("a rate is never added: impuestos offers only «Reemplazar»", async () => {
    show(
      async () => ok({ draft: withLines([mk("t", "IVA", "impuestos", 16)]) }),
      { impuestos: { value: 13, source: "manual", label: null } }
    );
    const row = await screen.findByTestId("upload-line");
    expect(
      within(row).getByRole("button", { name: "Reemplazar" })
    ).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /^Sumar/ })).toBe(null);
  });
});

describe("lines of one category", () => {
  it("«Aprobar todo» counts the lines of a cluster and their sum", async () => {
    show(async () =>
      ok({
        draft: withLines([
          mk("a", "Luz", "servicios", 100),
          mk("b", "Agua", "servicios", 50),
          mk("c", "Internet", "servicios", 30),
        ]),
      })
    );
    await screen.findAllByTestId("upload-line");
    expect(
      screen.getByRole("button", { name: /^Aprobar todo \(3 · \$180/ })
    ).toBeTruthy();
  });

  it("two impuestos lines of one key are ⚑ Falta with a message and cannot be approved", async () => {
    show(async () =>
      ok({
        draft: withLines([
          mk("a", "IVA", "impuestos", 10),
          mk("b", "ISR", "impuestos", 6),
        ]),
      })
    );
    const lines = await screen.findAllByTestId("upload-line");
    for (const row of lines) {
      expect(within(row).getAllByText(/Falta/).length).toBeGreaterThan(0);
      expect(row.textContent).toContain("Una tasa no se suma");
      expect(within(row).queryByRole("button", { name: "Aprobar" })).toBe(null);
    }
  });
});
