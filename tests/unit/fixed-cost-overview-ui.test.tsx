// @vitest-environment jsdom
// The overview as the owner sees it: missing never looks like 0, shared costs and
// the tax rate stay apart, a partial month offers no final-looking target.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { FixedCostOverview } from "@/components/restaurant/costs/FixedCostOverview";
import { buildOverview } from "@/lib/restaurant/fixed-cost-overview";
import {
  NOV,
  OCT,
  acceptance,
  line,
  monthInput,
} from "./fixtures/fixed-cost-redesign";

afterEach(cleanup);

function mount(extra: Partial<Parameters<typeof FixedCostOverview>[0]> = {}) {
  const { sep, oct, nov } = acceptance();
  const props = {
    overview: buildOverview([sep, oct, nov]),
    currency: "USD",
    selectedMonth: NOV,
    expanded: new Set<never>(),
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    changed: new Set<string>(),
    onShift: vi.fn(),
    canShiftLater: false,
    ...extra,
  };
  render(<FixedCostOverview {...props} />);
  return props;
}

describe("overview", () => {
  it("shows September | October | November with the cash categories as rows", () => {
    mount();
    expect(screen.getByTestId("window-label").textContent).toMatch(
      /septiembre.*octubre.*noviembre/i
    );
    for (const c of ["planilla", "alquiler", "servicios", "otros"])
      expect(screen.getByTestId(`row-${c}`)).toBeTruthy();
  });

  it("a missing amount is a dash read as «Falta», never 0", () => {
    mount();
    const cell = screen.getByTestId("cell-2026-09-01-planilla");
    expect(cell.textContent).toContain("—");
    expect(cell.textContent).toContain("Falta");
    expect(cell.textContent).not.toMatch(/\b0([.,]00)?\b/);
    expect(screen.getByTestId("local-2026-09-01").textContent).not.toMatch(
      /0[.,]00/
    );
  });

  it("recorded amounts open their detail on click", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("cell-2026-10-01-planilla"));
    expect(p.onOpen).toHaveBeenCalledWith(OCT, "planilla");
  });

  it("October local, shared and combined are separate lines; the 13 % is a rate", () => {
    mount();
    expect(screen.getByTestId("local-2026-10-01").textContent).toMatch(
      /32[.,\s]?920/
    );
    expect(screen.getByTestId("shared-2026-10-01").textContent).toMatch(
      /21[.,\s]?000/
    );
    expect(screen.getByTestId("combined-2026-10-01").textContent).toMatch(
      /53[.,\s]?920/
    );
    expect(screen.getByTestId("tax-2026-10-01").textContent).toBe("13%");
    expect(screen.getByTestId("tax-2026-11-01").textContent).toMatch(
      /Falta la tasa/
    );
  });

  it("November stays 25 800 and partial, with no daily target", () => {
    mount();
    expect(screen.getByTestId("local-2026-11-01").textContent).toMatch(
      /25[.,\s]?800/
    );
    expect(screen.getByText(/Parcial · falta/)).toBeTruthy();
    const be = screen.getByTestId("breakeven-2026-11-01");
    expect(be.textContent).toMatch(/Sin objetivo diario hasta completar/);
    expect(be.textContent).not.toMatch(/\$|USD/);
  });

  it("a complete month offers its target; a confirmed zero says so in words", () => {
    const zero = monthInput(NOV, [
      line(NOV, "planilla", 0),
      line(NOV, "alquiler", 1),
      line(NOV, "servicios", 1),
      line(NOV, "otros", 1),
      line(NOV, "impuestos", 13),
    ]);
    mount({ overview: buildOverview([zero]) });
    expect(
      screen.getByTestId("cell-2026-11-01-planilla").parentElement?.textContent
    ).toContain("Cero confirmado");
    expect(screen.getByTestId("breakeven-2026-11-01").textContent).not.toMatch(
      /Sin objetivo/
    );
  });

  it("recurring references are labelled as expectations and not totalled", () => {
    const ov = buildOverview([
      monthInput(OCT, [line(OCT, "alquiler", 6500, { repeats: true })]),
      monthInput(NOV, []),
    ]);
    mount({ overview: ov });
    const cell = screen.getByTestId("cell-2026-11-01-alquiler");
    expect(cell.textContent).toContain("Recurrente");
    expect(screen.getByTestId("local-2026-11-01").textContent).toContain("—");
  });

  it("expanding services lists each position once, across the same months", () => {
    mount({ expanded: new Set(["servicios"]) as never });
    for (const k of ["agua", "electricidad", "gas", "internet", "seguro"])
      expect(screen.getAllByTestId(`position-servicios-${k}`)).toHaveLength(1);
    const gas = screen.getByTestId("position-servicios-gas");
    expect(within(gas).getAllByRole("cell")).toHaveLength(3);
  });

  it("highlights the cells an import changed and only those", () => {
    mount({ changed: new Set([`${OCT}|planilla`]) });
    const hit = screen.getByTestId("cell-2026-10-01-planilla").parentElement;
    const miss = screen.getByTestId("cell-2026-10-01-alquiler").parentElement;
    expect(hit?.className).toContain("bg-[#E7EDFD]");
    expect(miss?.className).not.toContain("bg-[#E7EDFD]");
  });

  it("window navigation reports the direction; later is disabled at the current month", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("window-earlier"));
    expect(p.onShift).toHaveBeenCalledWith(-1);
    expect(
      (screen.getByTestId("window-later") as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
