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
  opts: {
    refresh?: boolean | "ok" | "rejected" | "unavailable";
    token?: string | null;
  } = {}
) {
  const fetchImpl = vi.fn(async () => responses.shift() as Response);
  const refreshSession = vi.fn(async () =>
    opts.refresh === true
      ? ("ok" as const)
      : opts.refresh === false || opts.refresh === undefined
        ? ("rejected" as const)
        : opts.refresh
  );
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

describe("Equipo de cocina and Cocina without a link", () => {
  it("self-device, team and team actions use the right paths and bodies", async () => {
    const { api, fetchImpl } = setup([
      json({ deviceToken: "t" }, 201),
      json({ kitchenCode: "K7M2QX", team: [] }),
      json({ temporaryPin: "482913" }),
      json({ inviteId: "i", inviteUrl: "u", expiresAt: "e" }),
      json({ success: true }),
      json({ success: true }),
    ]);
    await api.selfDevice({
      locationId: "loc-1",
      platform: "ios",
      deviceLabel: "iPhone",
    });
    await api.kitchenTeam();
    await api.resetPin("st-1", "temporary");
    await api.newLink("st-1");
    await api.signOutPhone("st-1", "dev-1");
    await api.signOutPhone("st-1");
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const body = (i: number) => JSON.parse(String(calls[i][1].body));
    expect(calls[0][0]).toMatch(/\/kitchen\/self-device$/);
    expect(body(0)).toEqual({
      locationId: "loc-1",
      platform: "ios",
      deviceLabel: "iPhone",
    });
    expect(calls[1][0]).toMatch(/\/kitchen\/team$/);
    expect(calls[2][0]).toMatch(/\/kitchen\/team\/st-1$/);
    expect(body(2)).toEqual({ action: "reset_pin", mode: "temporary" });
    expect(body(3)).toEqual({ action: "new_link" });
    expect(body(4)).toEqual({ action: "sign_out", deviceId: "dev-1" });
    expect(body(5)).toEqual({ action: "sign_out" });
  });

  it("a manager 401 that cannot be renewed still signs the manager out (policy unchanged)", async () => {
    const { api, onSignedOut } = setup([json({ reason: "unavailable" }, 401)], {
      refresh: false,
    });
    await expect(api.kitchenTeam()).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe("a 401 and the token renewal (revoked vs temporary trouble)", () => {
  const expired = () => json({ error: "x" }, 401);

  it("a renewal the SERVER rejects (revoked / expired refresh token) signs out", async () => {
    const { api, onSignedOut } = setup([expired()], { refresh: "rejected" });
    await expect(api.home(null)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("a renewal that fails for NETWORK / server reasons keeps the login and says «try again»", async () => {
    const { api, onSignedOut, refreshSession } = setup([expired()], {
      refresh: "unavailable",
    });
    const err = await api.home(null).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("network");
    expect(err.offline).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("a renewal that works retries once with the new token and stays signed in", async () => {
    const { api, onSignedOut, fetchImpl } = setup(
      [expired(), json({ ok: 1 })],
      {
        refresh: "ok",
      }
    );
    await expect(api.home(null)).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("a 401 right after a successful renewal means access really is gone: signs out", async () => {
    const { api, onSignedOut } = setup([expired(), expired()], {
      refresh: "ok",
    });
    await expect(api.home(null)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("an ordinary network or server error never touches the session", async () => {
    const { api, onSignedOut, refreshSession } = setup([
      json({ error: "down" }, 503),
    ]);
    await expect(api.home(null)).rejects.toMatchObject({ kind: "server" });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
