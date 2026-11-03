// @vitest-environment jsdom
// Costos fijos: «⇪ Subir archivo» is visible straight away; the inline review
// shows ⚑ Falta and «Sin precio» for lines Milton could not read, the lavender
// tag for AI lines, and asks before replacing a value (old → new).
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

function show(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", fetcher);
  render(
    <FixedCostUpload
      month="2026-10-01"
      locationId={LOC}
      currency="USD"
      locationNames={{ [LOC]: "Sucursal Demo Norte" }}
    />
  );
}
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("FixedCostUpload", () => {
  it("shows the button right away, no tab or menu", () => {
    show(async () => ok({ draft: null }));
    expect(
      screen.getByRole("button", { name: "⇪ Subir archivo" })
    ).toBeTruthy();
  });

  it("review: AI tag, ⚑ Falta, «Sin precio»; the unreadable line cannot be approved", async () => {
    show(async () => ok({ draft }));
    const lines = await screen.findAllByTestId("upload-line");
    expect(lines).toHaveLength(2);
    expect(within(lines[0]).getByText("Leído por Milton").className).toContain(
      "#DDD6FE"
    );
    expect(within(lines[1]).getAllByText(/Falta/).length).toBeGreaterThan(0);
    expect(within(lines[1]).getAllByText("Sin precio").length).toBeGreaterThan(
      0
    );
    expect(
      (
        within(lines[1]).getByRole("button", {
          name: "Aprobar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(/Nada cambia en tus costos fijos/)).toBeTruthy();
  });

  it("replacing an existing value asks first: old → new", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    show(async (url, init) => {
      if (init?.method === "POST") {
        const body = String(init.body);
        calls.push({ url, body });
        return JSON.parse(body).confirmed
          ? ok({
              approved: 1,
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
    fireEvent.click(screen.getByRole("button", { name: "Aprobar todo" }));
    const panel = await screen.findByTestId("overwrite-confirm");
    expect(panel.textContent).toContain("$6,500 → $7,000");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Reemplazar y aprobar" })
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(calls[1].body).confirmed).toEqual(["l1"]);
  });
});

describe("lines of one category", () => {
  const mk = (id: string, raw: string, category: string, amount: number) => ({
    id,
    raw,
    category,
    amount,
    month: "2026-10-01",
    scope: { kind: "restaurant", locationId: LOC },
    from: "file",
    status: "pending",
  });

  it("shows «Servicios: 3 líneas · total» before approving", async () => {
    show(async () =>
      ok({
        draft: {
          ...draft,
          lines: [
            mk("a", "Luz", "servicios", 100),
            mk("b", "Agua", "servicios", 50),
            mk("c", "Internet", "servicios", 30),
          ],
        },
      })
    );
    const totals = await screen.findByTestId("category-totals");
    expect(totals.textContent).toMatch(/Servicios/);
    expect(totals.textContent).toContain("3 líneas");
    expect(totals.textContent).toContain("$180");
  });

  it("two impuestos lines of one key are ⚑ Falta with a message and cannot be approved", async () => {
    show(async () =>
      ok({
        draft: {
          ...draft,
          lines: [
            mk("a", "IVA", "impuestos", 10),
            mk("b", "ISR", "impuestos", 6),
          ],
        },
      })
    );
    const lines = await screen.findAllByTestId("upload-line");
    for (const row of lines) {
      expect(within(row).getAllByText(/Falta/).length).toBeGreaterThan(0);
      expect(row.textContent).toContain("Una tasa no se suma");
      expect(
        (
          within(row).getByRole("button", {
            name: "Aprobar",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
    }
    expect(screen.queryByTestId("category-totals")).toBeNull();
  });
});
