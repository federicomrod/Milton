// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh, replace() {} }),
}));
const savePrefs = vi.hoisted(() => vi.fn(async (p: unknown) => p));
vi.mock("@/lib/profile-service", async () => {
  const real = await vi.importActual<typeof import("@/lib/profile-service")>(
    "@/lib/profile-service"
  );
  return { ...real, saveUserPreferences: savePrefs };
});

import { AjustesClient } from "@/components/restaurant/config/ajustes/AjustesClient";
import { ConfigProvider } from "@/components/restaurant/config/ConfigProvider";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n";

const es = getDictionary("es").config;
let fetchMock: ReturnType<typeof vi.fn>;

function ui(over: Record<string, unknown> = {}) {
  return (
    <I18nProvider lang="es">
      <ConfigProvider>
        <AjustesClient
          canEdit
          legalAvailable
          currency="USD"
          preferences={{ timezone: "Europe/Madrid", theme: "dark" }}
          company={{
            name: "Casa Centro",
            legal_name: "",
            tax_id: "",
            address: "Calle 1",
          }}
          {...over}
        />
      </ConfigProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  savePrefs.mockClear();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Ajustes", () => {
  it("shows values read-only and «Falta: añadir» for empties", () => {
    render(ui());
    expect(screen.getByText("Casa Centro")).toBeTruthy();
    expect(screen.getByText("Calle 1")).toBeTruthy();
    expect(screen.getAllByText(es.shared.missing)).toHaveLength(2);
    expect(screen.getByTestId("ajustes-currency").textContent).toContain("USD");
    expect(screen.getByRole("radio", { name: "Deutsch" })).toBeTruthy();
  });

  it("Editar opens the form and keeps typed values on a server error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Muy largo", field: "tax_id" }),
    });
    render(ui());
    fireEvent.click(screen.getByText(es.shared.edit));
    fireEvent.change(screen.getByLabelText(es.ajustes.company.taxId), {
      target: { value: "ABC123" },
    });
    fireEvent.click(screen.getByText(es.shared.save));
    await waitFor(() => screen.getAllByText(/Muy largo/));
    expect(
      (screen.getByLabelText(es.ajustes.company.taxId) as HTMLInputElement)
        .value
    ).toBe("ABC123");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tax_id: "ABC123",
    });
  });

  it("saves the language on change and refreshes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ company: { preferred_language: "de" } }),
    });
    render(ui());
    fireEvent.click(screen.getByRole("radio", { name: "Deutsch" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      preferred_language: "de",
    });
  });

  it("disables the language without company.edit", () => {
    render(ui({ canEdit: false }));
    expect(
      (screen.getByRole("radio", { name: "English" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getAllByText(es.shared.readOnly).length).toBeGreaterThan(0);
  });

  it("saves a preference keeping the other values", async () => {
    render(ui());
    fireEvent.change(screen.getByLabelText(/Fecha/), {
      target: { value: "YYYY-MM-DD" },
    });
    await waitFor(() => expect(savePrefs).toHaveBeenCalled());
    expect(savePrefs.mock.calls[0][0]).toMatchObject({
      timezone: "Europe/Madrid",
      theme: "dark",
      date_format: "YYYY-MM-DD",
      number_format: "1,000.00",
    });
  });
});
