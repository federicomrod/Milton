import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { createManagerApi } from "./api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function setup(
  responses: Response[],
  opts: { refresh?: boolean; token?: string | null } = {}
) {
  const fetchImpl = vi.fn(async () => responses.shift() as Response);
  const refreshSession = vi.fn(async () => opts.refresh ?? false);
  const onSignedOut = vi.fn();
  const api = createManagerApi({
    baseUrl: "https://api.example.test/",
    getToken: async () => (opts.token === undefined ? "access-1" : opts.token),
    refreshSession,
    onSignedOut,
    language: () => "de",
    fetchImpl: fetchImpl as never,
    timeoutMs: 50,
  });
  return { api, fetchImpl, refreshSession, onSignedOut };
}

const headersOf = (f: ReturnType<typeof vi.fn>, i = 0) =>
  (f.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<
    string,
    string
  >;
const urlOf = (f: ReturnType<typeof vi.fn>, i = 0) =>
  (f.mock.calls[i] as unknown as [string])[0];

describe("manager api", () => {
  it("sends the access token only as a bearer, with the company language", async () => {
    const { api, fetchImpl } = setup([json({ pending: 1 })]);
    await api.home("loc-1");
    expect(urlOf(fetchImpl)).toBe(
      "https://api.example.test/api/mobile/v1/home?location=loc-1"
    );
    expect(headersOf(fetchImpl).Authorization).toBe("Bearer access-1");
    expect(headersOf(fetchImpl)["Accept-Language"]).toBe("de");
    expect(urlOf(fetchImpl)).not.toContain("access-1");
  });

  it("builds each screen's query", async () => {
    const { api, fetchImpl } = setup([json({}), json({}), json({}), json({})]);
    await api.ventas("week", null);
    await api.rentabilidad("2026-10-01", "loc-1");
    await api.costos(null);
    await api.home(null);
    expect(urlOf(fetchImpl, 0)).toMatch(/\/ventas\?period=week$/);
    expect(urlOf(fetchImpl, 1)).toMatch(
      /\/rentabilidad\?month=2026-10-01&location=loc-1$/
    );
    expect(urlOf(fetchImpl, 2)).toMatch(/\/costos$/);
    expect(urlOf(fetchImpl, 3)).toMatch(/\/home$/);
  });

  it("login does not send a token and posts the credentials in the body, not the URL", async () => {
    const { api, fetchImpl } = setup(
      [json({ accessToken: "a", refreshToken: "r" })],
      { token: null }
    );
    await api.login("ana@example.test", "s3cret");
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      email: "ana@example.test",
      password: "s3cret",
    });
    expect(urlOf(fetchImpl)).not.toContain("s3cret");
  });

  it("approve and reject post to the invoice's own URL", async () => {
    const { api, fetchImpl } = setup([json({}), json({})]);
    await api.approveInvoice("inv 1");
    await api.rejectInvoice("inv-2");
    expect(urlOf(fetchImpl, 0)).toMatch(/\/invoices\/inv%201\/approve$/);
    expect(urlOf(fetchImpl, 1)).toMatch(/\/invoices\/inv-2\/reject$/);
  });

  it("a 401 renews the session once and retries the same request", async () => {
    const { api, fetchImpl, refreshSession, onSignedOut } = setup(
      [json({ error: "x" }, 401), json({ ok: true })],
      { refresh: true }
    );
    await expect(api.costos(null)).resolves.toEqual({ ok: true });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("a 401 that cannot be renewed signs the manager out", async () => {
    const { api, onSignedOut } = setup([json({ error: "x" }, 401)], {
      refresh: false,
    });
    await expect(api.costos(null)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("a 401 again after renewing also signs out (no endless loop)", async () => {
    const { api, fetchImpl, onSignedOut } = setup(
      [json({}, 401), json({}, 401)],
      { refresh: true }
    );
    await expect(api.home(null)).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("a 403 (no access) is a client error, not a sign-out", async () => {
    const { api, onSignedOut } = setup([json({ error: "no" }, 403)]);
    await expect(api.home(null)).rejects.toMatchObject({
      kind: "client",
      status: 403,
    });
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
