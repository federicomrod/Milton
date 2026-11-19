// Tests for useActivityTracking hook.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useActivityTracking } from "./useActivityTracking";
import { useManager } from "./ManagerProvider";

vi.mock("./ManagerProvider", () => ({
  useManager: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

// Mock AppState
let appStateListeners: Array<(state: any) => void> = [];
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: vi.fn((event: string, callback: any) => {
      appStateListeners.push(callback);
      return { remove: vi.fn(() => {
        appStateListeners = appStateListeners.filter((l) => l !== callback);
      }) };
    }),
  },
  Platform: {
    OS: "ios",
  },
}));

describe("useActivityTracking", () => {
  const mockRecordActivity = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    appStateListeners = [];
    vi.mocked(useManager).mockReturnValue({
      api: { recordActivity: mockRecordActivity },
    } as any);
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    vi.mocked(SecureStore.setItemAsync).mockResolvedValue();
    mockRecordActivity.mockResolvedValue({ recorded: true });
  });

  afterEach(() => {
    appStateListeners = [];
  });

  it("should record activity on mount (app opened)", async () => {
    renderHook(() => useActivityTracking("gestion"));

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalledWith("gestion", "ios");
    });
  });

  it("should record activity when app comes to foreground", async () => {
    renderHook(() => useActivityTracking("cocina"));

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalledTimes(1);
    });

    mockRecordActivity.mockClear();

    // Simulate app going to background then foreground
    appStateListeners.forEach((listener) => listener("background"));
    appStateListeners.forEach((listener) => listener("active"));

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalledWith("cocina", "ios");
    });
  });

  it("should throttle calls to once every 15 minutes", async () => {
    const now = Date.now();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(String(now - 10 * 60 * 1000)); // 10 min ago

    renderHook(() => useActivityTracking("gestion"));

    await waitFor(() => {
      // Should not call because last ping was only 10 minutes ago
      expect(mockRecordActivity).not.toHaveBeenCalled();
    });

    // Set last ping to 16 minutes ago
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(String(now - 16 * 60 * 1000));

    const { rerender } = renderHook(() => useActivityTracking("gestion"));
    rerender();

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalledWith("gestion", "ios");
    });
  });

  it("should fail silently when API call fails", async () => {
    mockRecordActivity.mockRejectedValue(new Error("Network error"));

    // Should not throw
    expect(() => {
      renderHook(() => useActivityTracking("gestion"));
    }).not.toThrow();

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalled();
    });
  });

  it("should handle SecureStore errors gracefully", async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error("Store error"));
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error("Store error"));

    // Should not throw
    expect(() => {
      renderHook(() => useActivityTracking("gestion"));
    }).not.toThrow();

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalled();
    });
  });

  it("should clean up AppState listener on unmount", () => {
    const { unmount } = renderHook(() => useActivityTracking("gestion"));

    expect(appStateListeners.length).toBeGreaterThan(0);

    unmount();

    // Listener should be removed
    expect(appStateListeners.length).toBe(0);
  });

  it("should not record if app only goes inactive (not background)", async () => {
    renderHook(() => useActivityTracking("gestion"));

    await waitFor(() => {
      expect(mockRecordActivity).toHaveBeenCalledTimes(1); // Initial mount
    });

    mockRecordActivity.mockClear();

    // Go inactive then active (e.g. system dialog) - should not record
    appStateListeners.forEach((listener) => listener("inactive"));
    appStateListeners.forEach((listener) => listener("active"));

    // Wait a bit to ensure no call is made
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should NOT record for inactive -> active
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });
});
