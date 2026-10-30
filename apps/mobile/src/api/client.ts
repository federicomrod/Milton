// Typed fetch wrapper for the kitchen API. The device token goes ONLY in the
// Authorization header; errors carry a kind and a status, never the server's
// text, the URL or the token, so nothing here can leak into a log or a screen.

import type { Strings } from "../i18n/strings";
import type {
  HistoryPage,
  KitchenMe,
  RecipesPage,
  RedeemResponse,
  UploadResult,
  UploadTicket,
} from "./types";

export type ApiErrorKind =
  | "network" // no connection
  | "timeout"
  | "unreachable" // answered, but not with our JSON (for example a login wall)
  | "unauthorized" // the device token is no longer valid
  | "client" // 4xx
  | "server"; // 5xx

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly reason?: string
  ) {
    super(kind);
    this.name = "ApiError";
  }

  /** Worth trying again later (no connection, timeout, server trouble). */
  get retryable(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      this.kind === "unreachable" ||
      this.kind === "server"
    );
  }

  /** The phone could not reach Milton at all. */
  get offline(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      this.kind === "unreachable"
    );
  }
}

export interface ClientDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Called once when an authenticated request gets 401. */
  onUnauthorized: () => void | Promise<void>;
  /** The company language («es», «en», «de»): the server answers in it. */
  language?: string | (() => string);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;

export function createApiClient(deps: ClientDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl.replace(/\/+$/, "");

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; auth?: boolean } = {}
  ): Promise<T> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = { Accept: "application/json" };
    const language =
      typeof deps.language === "function" ? deps.language() : deps.language;
    if (language) headers["Accept-Language"] = language;
    if (auth) {
      const token = await deps.getToken();
      if (!token) throw new ApiError("unauthorized", 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS
    );
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && auth) {
      await deps.onUnauthorized();
      throw new ApiError("unauthorized", 401);
    }
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      throw new ApiError("unreachable", res.status);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ApiError("unreachable", res.status);
    }
    if (!res.ok) {
      const reason = (data as { reason?: unknown } | null)?.reason;
      throw new ApiError(
        res.status >= 500 ? "server" : "client",
        res.status,
        typeof reason === "string" ? reason : undefined
      );
    }
    return data as T;
  }

  const qs = (params: Record<string, string | null | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return {
    redeem: (input: {
      secret: string;
      name: string;
      platform: string;
      deviceLabel: string;
    }) =>
      request<RedeemResponse>("POST", "/api/mobile/v1/kitchen/redeem", {
        body: input,
        auth: false,
      }),
    me: () => request<KitchenMe>("GET", "/api/mobile/v1/kitchen/me"),
    history: (cursor?: string | null) =>
      request<HistoryPage>(
        "GET",
        `/api/mobile/v1/kitchen/history${qs({ cursor })}`
      ),
    recipes: (opts: { cursor?: string | null; q?: string | null } = {}) =>
      request<RecipesPage>(
        "GET",
        `/api/mobile/v1/kitchen/recipes${qs({ cursor: opts.cursor, q: opts.q })}`
      ),
    text: (input: { text: string; clientRef: string }) =>
      request<UploadResult>("POST", "/api/mobile/v1/kitchen/text", {
        body: input,
      }),
    uploadTicket: (input: {
      kind: "photo" | "voice" | "document";
      mime: string;
      sizeBytes: number;
      clientRef: string;
      text?: string | null;
      durationS?: number | null;
    }) =>
      request<UploadTicket>("POST", "/api/mobile/v1/kitchen/uploads", {
        body: input,
      }),
    uploadComplete: (input: {
      reportId: string;
      clientRef: string;
      path: string;
    }) =>
      request<UploadResult>("POST", "/api/mobile/v1/kitchen/uploads/complete", {
        body: input,
      }),
    logout: () =>
      request<{ success: boolean }>("POST", "/api/mobile/v1/kitchen/logout"),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

type ErrorStrings = Strings["errors"];

/** A plain message for any failure, in the device language. Never server text. */
export function friendlyMessage(err: unknown, e: ErrorStrings): string {
  if (!(err instanceof ApiError)) return e.generic;
  switch (err.kind) {
    case "network":
      return e.offline;
    case "timeout":
      return e.timeout;
    case "unreachable":
      return e.unreachable;
    case "unauthorized":
      return e.signIn;
    case "server":
      return e.server;
    default:
      return e.failed;
  }
}

/** Messages for the join screen. */
export function redeemMessage(err: unknown, e: ErrorStrings): string {
  if (err instanceof ApiError && err.kind === "client") {
    switch (err.reason) {
      case "used":
        return e.used;
      case "expired":
        return e.expired;
      case "revoked":
        return e.revoked;
      case "invalid":
        return e.invalid;
    }
    if (err.status === 429) return e.tooMany;
  }
  return friendlyMessage(err, e);
}
