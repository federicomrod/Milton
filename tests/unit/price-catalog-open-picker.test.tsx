// @vitest-environment jsdom
// openPicker() follows the same rule as the «Elegir archivo de costos» button:
// nothing while the panel is busy, so a click on «Continuar» / «Elegir archivo»
// during a save cannot start a second upload. Synthetic data only.
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PriceCatalogPanel,
  type PriceCatalogPanelHandle,
} from "@/components/restaurant/recipes-costing/PriceCatalogPanel";

let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  click = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ draft: null, open: [], conflicts: [] }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function draw(busyExternal: boolean) {
  const ref = createRef<PriceCatalogPanelHandle>();
  const view = render(
    <PriceCatalogPanel ref={ref} embedded busyExternal={busyExternal} />
  );
  return { ref, view };
}

describe("PriceCatalogPanel.openPicker", () => {
  it("does nothing while busy (same rule as the button)", async () => {
    const { ref } = draw(true);
    const button = await screen.findByRole("button", {
      name: /Elegir archivo de costos/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    ref.current?.openPicker();
    expect(click).not.toHaveBeenCalled();
  });

  it("clicks the file input when idle", async () => {
    const { ref } = draw(false);
    const button = await screen.findByRole("button", {
      name: /Elegir archivo de costos/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    ref.current?.openPicker();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("follows the busy state as it changes", async () => {
    const { ref, view } = draw(true);
    await screen.findByRole("button", { name: /Elegir archivo de costos/ });
    ref.current?.openPicker();
    expect(click).not.toHaveBeenCalled();
    view.rerender(
      <PriceCatalogPanel ref={ref} embedded busyExternal={false} />
    );
    ref.current?.openPicker();
    expect(click).toHaveBeenCalledTimes(1);
  });
});
