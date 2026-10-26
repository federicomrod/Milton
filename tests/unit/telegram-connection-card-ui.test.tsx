// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/restaurant/shell/shell-chrome-context", () => ({
  useCan: () => true,
}));

import { TelegramConnectionCard } from "@/components/restaurant/TelegramConnectionCard";

let connected = false;
let statusCalls = 0;

beforeEach(() => {
  vi.useFakeTimers();
  connected = false;
  statusCalls = 0;
  vi.stubGlobal("open", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.includes("pairing-code")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: "CODE123",
            deep_link: "https://t.me/DemoBot?start=CODE123",
            expires_at: "2099-01-01T00:00:00Z",
          }),
        };
      }
      statusCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connected,
          connected_at: null,
          company_name: connected ? "Demo Resto" : null,
          preferred_language: "es",
        }),
      };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openPairing() {
  render(<TelegramConnectionCard />);
  await act(async () => {});
  await act(async () => {
    screen.getByText("Conectar Telegram").click();
  });
  await act(async () => {});
}

describe("TelegramConnectionCard pairing box", () => {
  it("has overflow-safe classes", async () => {
    await openPairing();
    const title = screen.getByText("Termina de conectar en Telegram");
    expect(title.className).toContain("line-clamp-none");
    const alert = title.closest('[role="alert"]') as HTMLElement;
    expect(alert.className).toContain("min-w-0");
    expect(alert.className).toContain("overflow-hidden");
    const btn = screen.getByText(/Ya me conecté/).closest("button")!;
    for (const c of ["h-auto", "whitespace-normal", "text-left", "max-w-full"])
      expect(btn.className).toContain(c);
    expect(screen.getByText("@DemoBot").className).toContain("break-all");
    expect(screen.getByText(/\/start CODE123/).className).toContain(
      "break-all"
    );
  });

  it("polls every 3 s and shows Conectado a Demo Resto without pressing anything", async () => {
    await openPairing();
    const base = statusCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(statusCalls).toBe(base + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(statusCalls).toBe(base + 2);
    connected = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Conectado a Demo Resto")).toBeTruthy();
    expect(screen.getByText(/escanea el QR de cocina/)).toBeTruthy();
    const after = statusCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(statusCalls).toBe(after);
  });

  it("stops after 3 minutes", async () => {
    await openPairing();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(181_000);
    });
    const after = statusCalls;
    expect(after).toBeLessThanOrEqual(1 + 60);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusCalls).toBe(after);
  });

  it("cleans up on unmount", async () => {
    await openPairing();
    cleanup();
    const after = statusCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusCalls).toBe(after);
  });
});
