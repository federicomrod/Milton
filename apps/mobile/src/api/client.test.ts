import { describe, expect, it, vi } from "vitest";
import { de, en, es } from "../i18n/strings";
import {
  ApiError,
  createApiClient,
  friendlyMessage,
  redeemMessage,
} from "./client";

const TOKEN = "device-token-secret-value-0000000000000000";

function json(body: unknown, status = 200, type = "application/json") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": type },
  });
}

function setup(fetchImpl: typeof fetch, token: string | null = TOKEN) {
  const onUnauthorized = vi.fn();
  const api = createApiClient({
    baseUrl: "https://api.example.test/",
    getToken: async () => token,
    onUnauthorized,
    fetchImpl,
    timeoutMs: 50,
  });
  return { api, onUnauthorized };
}

describe("api client", () => {
  it("sends the device token as a bearer header, never in the URL", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        staff: { id: "s", name: "Luis" },
        company: { name: "C" },
        locations: [],
      })
    );
    const { api } = setup(fetchImpl as never);
    await api.me();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example.test/api/mobile/v1/kitchen/me");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    );
    expect(url).not.toContain(TOKEN);
  });

  it("redeem needs no token", async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        {
          deviceToken: "t",
          staff: { id: "s", name: "L" },
          location: { id: "l", name: "C" },
        },
        201
      )
    );
    const { api } = setup(fetchImpl as never, null);
    await api.redeem({
      secret: "x".repeat(20),
      name: "Luis",
      platform: "ios",
      deviceLabel: "iPhone",
    });
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(
      (init.headers as Record<string, string>).Authorization
    ).toBeUndefined();
  });

  it("401 on an authenticated call signs out once and throws unauthorized", async () => {
    const { api, onUnauthorized } = setup((async () =>
      json({ error: "x" }, 401)) as never);
    await expect(api.history()).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("no stored token is unauthorized without calling the network", async () => {
    const fetchImpl = vi.fn();
    const { api } = setup(fetchImpl as never, null);
    await expect(api.me()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an HTML answer (a login wall) is «unreachable», not a crash", async () => {
    const { api } = setup(
      (async () =>
        new Response("<html>Protected</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as never
    );
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("unreachable");
    expect(err.offline).toBe(true);
    expect(friendlyMessage(err, es.errors)).toBe(es.errors.unreachable);
  });

  it("maps no connection and timeouts", async () => {
    const down = setup((async () => {
      throw new TypeError("Network request failed");
    }) as never);
    expect(await down.api.me().catch((e) => e)).toMatchObject({
      kind: "network",
      retryable: true,
      offline: true,
    });

    const slow = setup(
      ((_: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          )
        )) as never
    );
    expect(await slow.api.me().catch((e) => e)).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
  });

  it("4xx is a client error with the server's machine reason, 5xx is retryable", async () => {
    const used = setup((async () =>
      json({ error: "texto del servidor", reason: "used" }, 409)) as never);
    const err = await used.api
      .redeem({
        secret: "x".repeat(20),
        name: "L",
        platform: "ios",
        deviceLabel: "d",
      })
      .catch((e) => e);
    expect(err).toMatchObject({
      kind: "client",
      status: 409,
      reason: "used",
      retryable: false,
    });
    const boom = setup((async () => json({ error: "x" }, 500)) as never);
    expect(await boom.api.history().catch((e) => e)).toMatchObject({
      kind: "server",
      retryable: true,
    });
  });

  it("errors never carry the server's text, the URL or the token", async () => {
    const { api } = setup((async () =>
      json({ error: `secreto ${TOKEN}` }, 400)) as never);
    const err = await api.me().catch((e) => e);
    expect(
      JSON.stringify({ m: err.message, k: err.kind, r: err.reason })
    ).not.toContain(TOKEN);
    expect(friendlyMessage(err, es.errors)).not.toContain(TOKEN);
  });

  it("builds query strings safely", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ recipes: [], nextCursor: null })
    );
    const { api } = setup(fetchImpl as never);
    await api.recipes({ q: "tacos al pastor&x=1", cursor: "abc" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.example.test/api/mobile/v1/kitchen/recipes?cursor=abc&q=tacos%20al%20pastor%26x%3D1"
    );
  });
});

describe("messages", () => {
  const client = (reason: string, status = 409) =>
    new ApiError("client", status, reason);
  it("join errors are plain text for used, expired, revoked and invalid, in every language", () => {
    for (const d of [es, en, de]) {
      expect(redeemMessage(client("used"), d.errors)).toBe(d.errors.used);
      expect(redeemMessage(client("expired", 410), d.errors)).toBe(
        d.errors.expired
      );
      expect(redeemMessage(client("revoked", 410), d.errors)).toBe(
        d.errors.revoked
      );
      expect(redeemMessage(client("invalid", 404), d.errors)).toBe(
        d.errors.invalid
      );
      expect(redeemMessage(client("x", 429), d.errors)).toBe(d.errors.tooMany);
      expect(redeemMessage(new ApiError("network"), d.errors)).toBe(
        d.errors.offline
      );
      expect(redeemMessage(new Error("boom"), d.errors)).toBe(d.errors.generic);
    }
    expect(redeemMessage(client("used"), es.errors)).toMatch(/ya se usó/);
    expect(redeemMessage(client("used"), de.errors)).toMatch(/benutzt/);
  });

  it("sends the device language so the server answers in it", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [], nextCursor: null }));
    const api = createApiClient({
      baseUrl: "https://api.example.test",
      getToken: async () => TOKEN,
      onUnauthorized: () => undefined,
      language: "de",
      fetchImpl: fetchImpl as never,
    });
    await api.history();
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect((init.headers as Record<string, string>)["Accept-Language"]).toBe(
      "de"
    );
  });
});

describe("«Reintentar» and the company language", () => {
  it("retryReport posts the report id to the server (never in the URL)", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "requeued" }));
    const { api } = setup(fetchImpl as never);
    await expect(api.retryReport("r-1")).resolves.toEqual({
      status: "requeued",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example.test/api/mobile/v1/kitchen/retry");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reportId: "r-1" });
    expect(url).not.toContain("r-1");
  });

  it("Accept-Language follows the language function at call time", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [], nextCursor: null }));
    let language = "es";
    const api = createApiClient({
      baseUrl: "https://api.example.test",
      getToken: async () => TOKEN,
      onUnauthorized: vi.fn(),
      fetchImpl: fetchImpl as never,
      language: () => language,
    });
    await api.history();
    language = "de";
    await api.history();
    const langs = fetchImpl.mock.calls.map(
      (c) =>
        (
          (c as unknown as [string, RequestInit])[1].headers as Record<
            string,
            string
          >
        )["Accept-Language"]
    );
    expect(langs).toEqual(["es", "de"]);
  });
});
