// @vitest-environment jsdom
// Configuración › Mi cuenta: read-only summary, Editar opens forms. Synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
}));
vi.mock("@/components/restaurant/shell/shell-chrome-context", () => ({
  useCan: () => true,
}));
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      updateUser: (a: unknown) => updateUser(a),
      getUser: async () => ({ data: { user: { id: "u1" } } }),
    },
    from: () => ({ update: () => ({ eq: async () => ({}) }) }),
  }),
}));

import { AccountCards } from "@/components/restaurant/config/account/AccountCards";
import { ConfigProvider } from "@/components/restaurant/config/ConfigProvider";

function mount(over: Partial<React.ComponentProps<typeof AccountCards>> = {}) {
  return render(
    <ConfigProvider>
      <AccountCards
        name="Ana Demo"
        email="ana@example.com"
        createdAt="2025-03-04T00:00:00Z"
        billingStatus={null}
        {...over}
      />
    </ConfigProvider>
  );
}

beforeEach(() => {
  updateUser.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("email/preferences")
          ? {
              cadence: "daily",
              recipient: "a@b.co",
              weekday: 1,
              timezone: "Europe/Madrid",
            }
          : { connected: true, preferred_language: "es" },
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Mi cuenta", () => {
  it("shows values read-only on load", async () => {
    mount();
    await act(async () => {});
    expect(screen.getByText("Ana Demo")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("••••••••")).toBeTruthy();
    expect(screen.getByText("Cambiar contraseña")).toBeTruthy();
    expect(screen.getByText("Prueba gratis")).toBeTruthy();
    expect(screen.getByText(/Diario · Europe\/Madrid · a@b\.co/)).toBeTruthy();
    expect(screen.getByText("Conectado")).toBeTruthy();
  });

  it("shows «Falta: añadir» for an empty name", async () => {
    mount({ name: "" });
    await act(async () => {});
    expect(screen.getAllByText("Falta: añadir").length).toBeGreaterThan(0);
  });

  it("Editar opens the name form", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getAllByText("Editar")[0]);
    expect(screen.getByPlaceholderText("Tu nombre")).toBeTruthy();
  });

  it("validates the password (min 8, match) and keeps typed values", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByText("Cambiar contraseña"));
    const [a, b] = Array.from(
      document.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(a, { target: { value: "short" } });
    fireEvent.change(b, { target: { value: "short" } });
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByText(/Mínimo 8 caracteres/)).toBeTruthy();
    fireEvent.change(a, { target: { value: "longenough1" } });
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByText(/no coinciden/)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
    expect(a.value).toBe("longenough1");
  });

  it("changes the password through Supabase Auth", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByText("Cambiar contraseña"));
    const [a, b] = Array.from(
      document.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(a, { target: { value: "longenough1" } });
    fireEvent.change(b, { target: { value: "longenough1" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Guardar"));
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" });
  });
});
