// @vitest-environment jsdom
// Configuración › Restaurantes and Conexiones. Synthetic data only.
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));
vi.mock("@/components/restaurant/TelegramConnectionCard", () => ({
  TelegramConnectionCard: () => <div data-testid="tg-card">TG</div>,
}));
vi.mock("@/components/restaurant/settings/PosSalesUploadPanel", () => ({
  PosSalesUploadPanel: () => <div data-testid="pos-upload">UP</div>,
}));

import { deriveConnectionStatus } from "@/components/restaurant/config/sites/connection-status";
import {
  RestaurantRows,
  type SiteRow,
} from "@/components/restaurant/config/sites/RestaurantRows";
import { ConnectionCards } from "@/components/restaurant/config/sites/ConnectionCards";

const NOW = new Date("2026-06-10T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("deriveConnectionStatus", () => {
  it("not connected when inactive", () => {
    expect(
      deriveConnectionStatus({ active: false, lastSyncAt: null, now: NOW })
    ).toEqual({ status: "none", reason: "none" });
  });
  it("connected with a recent sync", () => {
    expect(
      deriveConnectionStatus({
        active: true,
        lastSyncAt: hoursAgo(2),
        now: NOW,
      }).status
    ).toBe("connected");
  });
  it("review: never synced, stale, unmatched, companies missing", () => {
    const r = (o: object) =>
      deriveConnectionStatus({
        active: true,
        lastSyncAt: hoursAgo(1),
        now: NOW,
        ...o,
      });
    expect(r({ lastSyncAt: null })).toEqual({
      status: "review",
      reason: "noSync",
    });
    expect(r({ lastSyncAt: hoursAgo(72) })).toEqual({
      status: "review",
      reason: "stale",
    });
    expect(r({ hasUnmatched: true }).reason).toBe("unmatched");
    expect(r({ companiesMissing: true }).reason).toBe("noCompanies");
  });
  it("error wins over a recent sync", () => {
    expect(
      deriveConnectionStatus({
        active: true,
        lastSyncAt: hoursAgo(1),
        hasError: true,
        now: NOW,
      })
    ).toEqual({ status: "error", reason: "error" });
  });
  it("no sync expected is connected", () => {
    expect(
      deriveConnectionStatus({
        active: true,
        lastSyncAt: null,
        noSyncExpected: true,
      }).status
    ).toBe("connected");
  });
});

const rows: SiteRow[] = [
  {
    id: "a",
    name: "Casa Norte",
    address: "Calle 1",
    city: "CDMX",
    odooCompanyId: 7,
    archived: false,
  },
  {
    id: "b",
    name: "Casa Sur",
    address: null,
    city: null,
    odooCompanyId: null,
    archived: false,
  },
];

describe("RestaurantRows", () => {
  it("shows current values, Falta for empties, highlights the selected", () => {
    const html = renderToStaticMarkup(
      <RestaurantRows rows={rows} archiveAvailable currentId="a" />
    );
    expect(html).toContain("Casa Norte");
    expect(html).toContain("Calle 1, CDMX");
    expect(html).toContain("Odoo n.º 7");
    expect(html).toContain("Falta: añadir");
    expect(html).toContain("En pantalla");
    expect(html).toMatch(/data-testid="site-a"[^>]*data-current="true"/);
    expect(html).toMatch(/data-testid="site-b"[^>]*data-current="false"/);
  });
  it("Editar opens the name form; Cancelar closes it", () => {
    render(
      <RestaurantRows rows={rows} archiveAvailable={false} currentId={null} />
    );
    fireEvent.click(screen.getAllByText("Editar")[0]);
    expect(screen.getByDisplayValue("Casa Norte")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByDisplayValue("Casa Norte")).toBeNull();
  });
});

describe("ConnectionCards", () => {
  const props = {
    odoo: {
      status: "review" as const,
      reason: "stale" as const,
      lastSyncAt: null,
    },
    telegram: { status: "none" as const, connectedAt: null },
    isAdmin: false,
    lang: "es" as const,
  };
  it("renders chips and Reconectar, upload closed by default", () => {
    render(<ConnectionCards {...props} uploadOpen={false} />);
    expect(screen.getByText("Revisar")).toBeTruthy();
    expect(screen.getByText("Sin conectar")).toBeTruthy();
    expect(
      screen.getByText("Reconectar").closest("a")?.getAttribute("href")
    ).toBe("/dashboard/restaurant/connect-data");
    expect(screen.queryByTestId("pos-upload")).toBeNull();
    fireEvent.click(screen.getByText("Abrir"));
    expect(screen.getByTestId("pos-upload")).toBeTruthy();
  });
  it("opens the upload when asked, staff go to /management/odoo, Telegram opens inline", () => {
    render(<ConnectionCards {...props} isAdmin uploadOpen />);
    expect(screen.getByTestId("pos-upload")).toBeTruthy();
    expect(
      screen.getByText("Reconectar").closest("a")?.getAttribute("href")
    ).toBe("/management/odoo");
    fireEvent.click(screen.getByText("Conectar"));
    expect(screen.getByTestId("tg-card")).toBeTruthy();
  });
});
