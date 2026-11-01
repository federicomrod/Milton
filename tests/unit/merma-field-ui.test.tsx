// @vitest-environment jsdom
// «Merma» field: range message, «desde hoy» saves at once, «aplicar a semanas
// anteriores» asks «Esto cambia el costo de los meses anteriores. ¿Continuar?»
// first, read-only for non-managers, history under the field.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { I18nProvider } from "@/lib/i18n/client";
import { MermaField } from "@/components/restaurant/costs/MermaField";
import type { HistoryLine } from "@/lib/restaurant/kitchen-buffer-server";
import type { PreferredLanguage } from "@/lib/restaurant/language";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const history: HistoryLine[] = [
  {
    id: "3",
    createdAt: "2026-11-20T09:00:00Z",
    effectiveFrom: "2026-11-20",
    who: "Ana Demo",
    isSupport: false,
    oldPct: 6,
    newPct: 12,
    kind: "today",
  },
  {
    id: "2",
    createdAt: "2026-11-10T10:00:00Z",
    effectiveFrom: "2026-09-15",
    who: null,
    isSupport: true,
    oldPct: 0,
    newPct: 6,
    kind: "retroactive",
  },
];

function mount(
  opts: { canEdit?: boolean; lang?: PreferredLanguage; max?: number } = {}
) {
  return render(
    <I18nProvider lang={opts.lang ?? "es"}>
      <MermaField
        endpoint="/api/test"
        buildBody={(pct, scope) => ({ pct, scope })}
        valueNode={<span>Merma: 5 %</span>}
        currentPct={5}
        max={opts.max ?? 30}
        canEdit={opts.canEdit ?? true}
        history={history}
        idPrefix="t"
        strings={{
          change: "Cambiar",
          pctLabel: "Merma",
          invalid: "Escribe un número de 0 a 30.",
          saveFailed: "No se pudo guardar.",
        }}
      />
    </I18nProvider>
  );
}
const ok = () =>
  vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  );

describe("MermaField", () => {
  it("«Solo desde hoy» saves without a confirmation", async () => {
    const fetchSpy = ok();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    fireEvent.click(screen.getByText("Cambiar"));
    fireEvent.change(screen.getByLabelText("Merma"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.queryByTestId("retro-confirm")).toBeNull();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(
        (fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1]
          .body
      )
    ).toEqual({ pct: 8, scope: "today" });
  });

  it("«Aplicar a semanas anteriores» asks first and saves only after «Continuar»", async () => {
    const fetchSpy = ok();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    fireEvent.click(screen.getByText("Cambiar"));
    fireEvent.change(screen.getByLabelText("Merma"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByLabelText("Aplicar a semanas anteriores"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByTestId("retro-confirm").textContent).toBe(
      "Esto cambia el costo de los meses anteriores. ¿Continuar?"
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    // «Volver» goes back without saving
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.queryByTestId("retro-confirm")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(
        (fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1]
          .body
      )
    ).toEqual({ pct: 8, scope: "all" });
  });

  it("an out-of-range or invalid value shows the message and sends nothing", () => {
    const fetchSpy = ok();
    vi.stubGlobal("fetch", fetchSpy);
    mount();
    fireEvent.click(screen.getByText("Cambiar"));
    for (const v of ["31", "-1", "abc", ""]) {
      fireEvent.change(screen.getByLabelText("Merma"), {
        target: { value: v },
      });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      expect(screen.getByRole("alert").textContent).toBe(
        "Escribe un número de 0 a 30."
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("retro-confirm")).toBeNull();
  });

  it("a server refusal is shown, nothing else happens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Tu rol no puede." }), {
            status: 403,
          })
      )
    );
    mount();
    fireEvent.click(screen.getByText("Cambiar"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Tu rol no puede.")
    );
  });

  it("read-only for non-managers: no button, no form", () => {
    mount({ canEdit: false });
    expect(screen.queryByText("Cambiar")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the history: date, who (Equipo Milton for support), old → new, desde hoy / retroactivo", () => {
    mount();
    const list = screen.getByTestId("merma-history").textContent as string;
    expect(list).toContain("Historial");
    expect(list).toContain("Ana Demo");
    expect(list).toContain("6 % → 12 %");
    expect(list).toContain("desde hoy");
    expect(list).toContain("Equipo Milton");
    expect(list).toContain("0 % → 6 %");
    expect(list).toContain("retroactivo");
    expect(list).not.toMatch(/@/); // no email, no raw id
  });

  it("speaks en and de", () => {
    mount({ lang: "en" });
    fireEvent.click(screen.getByText("Cambiar"));
    fireEvent.click(screen.getByLabelText("Apply to previous weeks"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("retro-confirm").textContent).toBe(
      "This changes the cost of previous months. Continue?"
    );
    cleanup();
    mount({ lang: "de" });
    expect(screen.getByTestId("merma-history").textContent).toContain(
      "Verlauf"
    );
    expect(screen.getByTestId("merma-history").textContent).toContain(
      "rückwirkend"
    );
  });
});
