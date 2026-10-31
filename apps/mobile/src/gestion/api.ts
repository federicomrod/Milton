// Typed client of the manager API. The Supabase access token goes ONLY in the
// Authorization header. A 401 first tries to renew the session once (the
// refresh token), then retries the same request; if that fails the caller is
// signed out. Errors never carry server text, the URL or a token.

import { ApiError, createRequester } from "../api/client";
import type {
  ApproveResult,
  CostosData,
  HomeData,
  KitchenInvite,
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

  return {
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
  };
}

export type ManagerApi = ReturnType<typeof createManagerApi>;
