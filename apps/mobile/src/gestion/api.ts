// Typed client of the manager API. The Supabase access token goes ONLY in the
// Authorization header. A 401 first tries to renew the session once (the
// refresh token), then retries the same request; if that fails the caller is
// signed out. Errors never carry server text, the URL or a token.

import { ApiError, createRequester } from "../api/client";
import type { RedeemResponse } from "../api/types";
import { createSseReader, type AskEvent, type ChatTurn } from "./ask-core";
import type {
  ApproveResult,
  CostosData,
  HomeData,
  KitchenInvite,
  KitchenTeam,
  LocationRef,
  ManagerMe,
  ManagerTokens,
  RentabilidadData,
  VentasData,
  VentasPeriod,
} from "./types";

export interface ManagerApiDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Renews the session. true = a new access token is ready. */
  refreshSession: () => Promise<boolean>;
  /** The session cannot be renewed: sign out. */
  onSignedOut: () => void | Promise<void>;
  language?: string | (() => string);
  fetchImpl?: typeof fetch;
  /** A fetch whose body can be read as it arrives (expo/fetch on the phone). */
  streamFetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const V1 = "/api/mobile/v1";

export function createManagerApi(deps: ManagerApiDeps) {
  // The shared requester never signs out by itself: renewing is handled below.
  const { request, qs } = createRequester({
    baseUrl: deps.baseUrl,
    getToken: deps.getToken,
    onUnauthorized: () => undefined,
    language: deps.language,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });

  async function authed<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof ApiError) || err.kind !== "unauthorized") throw err;
      if (await deps.refreshSession()) {
        try {
          return await run();
        } catch (again) {
          if (!(again instanceof ApiError) || again.kind !== "unauthorized") {
            throw again;
          }
        }
      }
      await deps.onSignedOut();
      throw err;
    }
  }

  const base = deps.baseUrl.replace(/\/+$/, "");
  const lang = () =>
    typeof deps.language === "function" ? deps.language() : deps.language;

  /** One authorised call with a raw response (streaming and audio). */
  async function rawOnce(
    path: string,
    init: { body: BodyInit; contentType: string; signal?: AbortSignal },
    doFetch: typeof fetch
  ): Promise<Response> {
    const token = await deps.getToken();
    if (!token) throw new ApiError("unauthorized", 401);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": init.contentType,
    };
    const l = lang();
    if (l) headers["Accept-Language"] = l;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: init.body,
        signal: init.signal,
      });
    } catch {
      throw new ApiError("network");
    }
    if (res.status === 401) throw new ApiError("unauthorized", 401);
    if (!res.ok) {
      throw new ApiError(res.status >= 500 ? "server" : "client", res.status);
    }
    return res;
  }

  return {
    /**
     * Preguntar a Milton. Calls `onEvent` for clarify / delta / final / error and
     * resolves when the stream ends. `location` = one restaurant; `all` = the
     * person chose «Todos». Nothing is stored on the phone.
     */
    ask: (input: {
      message: string;
      conversation: ChatTurn[];
      location?: string | null;
      all?: boolean;
      signal?: AbortSignal;
      onEvent: (e: AskEvent) => void;
    }) =>
      authed(async () => {
        const res = await rawOnce(
          `${V1}/ask${qs({ location: input.location })}`,
          {
            body: JSON.stringify({
              message: input.message,
              conversation: input.conversation,
              ...(input.all ? { scope: "all" } : {}),
            }),
            contentType: "application/json",
            signal: input.signal,
          },
          deps.streamFetchImpl ?? deps.fetchImpl ?? fetch
        );
        const reader = createSseReader(input.onEvent);
        if (!res.body) {
          reader.push(await res.text());
          reader.end();
          return;
        }
        const decoder = new TextDecoder();
        const stream = res.body.getReader();
        for (;;) {
          const { done, value } = await stream.read();
          if (done) break;
          reader.push(decoder.decode(value, { stream: true }));
        }
        reader.end();
      }),
    /** A spoken question to text. The audio is not kept on the server. */
    transcribe: (audio: Blob) =>
      authed(async () => {
        const res = await rawOnce(
          `${V1}/ask/transcribe`,
          { body: audio, contentType: "audio/m4a" },
          deps.fetchImpl ?? fetch
        );
        const body = (await res.json()) as { text?: unknown };
        if (typeof body.text !== "string") throw new ApiError("unreachable");
        return body.text;
      }),
    login: (email: string, password: string) =>
      request<ManagerTokens>("POST", `${V1}/auth/login`, {
        body: { email, password },
        auth: false,
      }),
    refresh: (refreshToken: string) =>
      request<ManagerTokens>("POST", `${V1}/auth/refresh`, {
        body: { refreshToken },
        auth: false,
      }),
    me: () => authed(() => request<ManagerMe>("GET", `${V1}/me`)),
    locations: () =>
      authed(() =>
        request<{ locations: LocationRef[] }>("GET", `${V1}/locations`)
      ),
    home: (location?: string | null) =>
      authed(() => request<HomeData>("GET", `${V1}/home${qs({ location })}`)),
    ventas: (period: VentasPeriod, location?: string | null) =>
      authed(() =>
        request<VentasData>("GET", `${V1}/ventas${qs({ period, location })}`)
      ),
    rentabilidad: (month: string | null, location: string) =>
      authed(() =>
        request<RentabilidadData>(
          "GET",
          `${V1}/rentabilidad${qs({ month, location })}`
        )
      ),
    costos: (location?: string | null) =>
      authed(() =>
        request<CostosData>("GET", `${V1}/costos${qs({ location })}`)
      ),
    approveInvoice: (id: string) =>
      authed(() =>
        request<ApproveResult>(
          "POST",
          `${V1}/invoices/${encodeURIComponent(id)}/approve`,
          { body: {} }
        )
      ),
    rejectInvoice: (id: string) =>
      authed(() =>
        request<{ status: string }>(
          "POST",
          `${V1}/invoices/${encodeURIComponent(id)}/reject`,
          { body: {} }
        )
      ),
    /** Invitar a mi equipo: the kitchen invites API, as the owner. */
    createKitchenInvite: (locationId: string) =>
      authed(() =>
        request<KitchenInvite>("POST", `${V1}/kitchen/invites`, {
          body: { locationId },
        })
      ),
    /** Cocina on this phone without a link: a kitchen device for the manager. */
    selfDevice: (input: {
      locationId?: string | null;
      platform: string;
      deviceLabel: string;
    }) =>
      authed(() =>
        request<RedeemResponse>("POST", `${V1}/kitchen/self-device`, {
          body: {
            ...(input.locationId ? { locationId: input.locationId } : {}),
            platform: input.platform,
            deviceLabel: input.deviceLabel,
          },
        })
      ),
    /** Equipo de cocina: the cooks, their PINs and phones, and the kitchen code. */
    kitchenTeam: () =>
      authed(() => request<KitchenTeam>("GET", `${V1}/kitchen/team`)),
    /** «Restablecer PIN»: a temporary PIN (shown once) or none. */
    resetPin: (staffId: string, mode: "temporary" | "clear") =>
      authed(() =>
        request<{ temporaryPin: string | null }>(
          "POST",
          `${V1}/kitchen/team/${encodeURIComponent(staffId)}`,
          { body: { action: "reset_pin", mode } }
        )
      ),
    /** «Enviar nuevo enlace» for a cook who lost the phone. */
    newLink: (staffId: string) =>
      authed(() =>
        request<{ inviteId: string; inviteUrl: string; expiresAt: string }>(
          "POST",
          `${V1}/kitchen/team/${encodeURIComponent(staffId)}`,
          { body: { action: "new_link" } }
        )
      ),
    /** «Cerrar sesión en este teléfono» (or on all of the cook's phones). */
    signOutPhone: (staffId: string, deviceId?: string) =>
      authed(() =>
        request<{ success: boolean }>(
          "POST",
          `${V1}/kitchen/team/${encodeURIComponent(staffId)}`,
          { body: { action: "sign_out", ...(deviceId ? { deviceId } : {}) } }
        )
      ),
  };
}

export type ManagerApi = ReturnType<typeof createManagerApi>;
