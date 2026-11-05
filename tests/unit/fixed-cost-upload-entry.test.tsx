// @vitest-environment jsdom
// Costos fijos: the blue «⚑ Falta cargar…» box's «Sube tus costos fijos» opens
// the SAME file picker as «⇪ Subir archivo», which sits above the categories in
// the group view, the restaurant view and an empty month. Rentabilidad's
// button goes to Costos fijos with the picker request (?subir=1), taken out of
// the URL once used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

import { FixedCostsTab } from "@/components/restaurant/costs/FixedCostsTab";
import {
  FIXED_UPLOAD_PARAM,
  fixedCostUploadHref,
} from "@/lib/restaurant/costs-tabs";
import type { FixedCostsView } from "@/lib/restaurant/fixed-costs-server";

const LOC = "00000000-0000-4000-8000-00000000000a";
const clicked = vi.fn();

beforeEach(() => {
  clicked.mockClear();
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ draft: null }), { status: 200 })
  );
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement
  ) {
    clicked(this.type);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const line = (category: string, amount: number) => ({
  location_id: null,
  month: "2026-10-01",
  category,
  label: null,
  amount,
  pct_of_sales: null,
  currency: "USD",
  repeats: false,
});

function view(over: Partial<FixedCostsView> = {}): FixedCostsView {
  return {
    month: "2026-10-01",
    currency: "USD",
    locationId: null,
    lines: [],
    groupShares: {},
    groupImpuestosPct: null,
    openDays: 30,
    margin: null,
    marginReason: null,
    breakEven: null,
    ...over,
  } as unknown as FixedCostsView;
}

function show(v: FixedCostsView, name: string | null = null) {
  render(
    <FixedCostsTab
      view={v}
      history={[]}
      locationName={name}
      shellParams={{}}
      currentMonth="2026-10-01"
    />
  );
}

const dropButton = () =>
  screen.getByRole("button", { name: "⇪ Subir factura" });
const headerButton = () =>
  screen.getByRole("button", { name: "⇪ Subir archivo" });

describe("opening the file picker in Costos fijos", () => {
  it("the empty page's «⇪ Subir factura» and every card's «Subir» open the same picker", () => {
    show(view());
    fireEvent.click(dropButton());
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledWith("file");
    fireEvent.click(screen.getAllByRole("button", { name: "Subir" })[0]);
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["group view (empty month)", view(), null, "drop"],
    [
      "group view (some categories)",
      view({ lines: [line("alquiler", 5000)] as never }),
      null,
      "header",
    ],
    [
      "restaurant view (empty month)",
      view({ locationId: LOC }),
      "Sucursal Demo Norte",
      "drop",
    ],
    [
      "restaurant view (some categories)",
      view({ locationId: LOC, lines: [line("alquiler", 5000)] as never }),
      "Sucursal Demo Norte",
      "header",
    ],
  ])("the upload button is above the categories: %s", (_n, v, name, kind) => {
    show(v, name);
    const button = kind === "drop" ? dropButton() : headerButton();
    const firstRow = screen.getByTestId("fixed-row-planilla");
    expect(
      button.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalledWith("file");
  });

  it("the group view still says it is the group's shared costs", () => {
    show(view());
    expect(screen.getByText("Costos compartidos del grupo")).toBeTruthy();
    expect(dropButton()).toBeTruthy();
  });

  it("?subir=1 opens the picker once and leaves the other params", () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/restaurant/costs?location=${LOC}&${FIXED_UPLOAD_PARAM}=1`
    );
    show(view({ locationId: LOC }), "Sucursal Demo Norte");
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe(`?location=${LOC}`);
  });

  it("without the param nothing opens by itself", () => {
    show(view());
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe("fixedCostUploadHref", () => {
  it("is Costos fijos with the picker request, other params kept", () => {
    expect(
      fixedCostUploadHref({ location: "loc-1", month: "2026-10-01" })
    ).toBe(
      `/dashboard/restaurant/costs?location=loc-1&month=2026-10-01&${FIXED_UPLOAD_PARAM}=1`
    );
    expect(fixedCostUploadHref({})).toBe(
      `/dashboard/restaurant/costs?${FIXED_UPLOAD_PARAM}=1`
    );
  });
});
