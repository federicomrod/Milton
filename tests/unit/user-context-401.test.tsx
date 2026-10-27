// @vitest-environment jsdom
// UserProvider must not retry /api/user on 401 (signed out, not a blip).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

import { UserProvider, useUser } from "@/lib/context/UserContext";

function Probe() {
  const { user, loading } = useUser();
  return (
    <div>
      <span data-testid="loading">{loading ? "yes" : "no"}</span>
      <span data-testid="user">{user?.id ?? "none"}</span>
    </div>
  );
}

describe("UserProvider 401", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized" }),
      }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not retry /api/user after a 401", async () => {
    render(
      <UserProvider>
        <Probe />
      </UserProvider>
    );

    await waitFor(() => {
      expect(document.querySelector("[data-testid=loading]")?.textContent).toBe(
        "no"
      );
    });
    expect(document.querySelector("[data-testid=user]")?.textContent).toBe(
      "none"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/user", { credentials: "include" });

    // The old first retry fired at 1s. Still one call after that window.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(fetch).toHaveBeenCalledTimes(1);
  }, 4000);

  it("the source has no 401 backoff loop", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/context/UserContext.tsx"),
      "utf8"
    );
    expect(src).toContain("response.status === 401");
    expect(src).not.toMatch(/retryCountRef|retrying \(\d\/3\)/);
    expect(src).not.toContain("setTimeout(() => fetchUser()");
  });
});
