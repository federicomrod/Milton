// Typed fetch wrapper for the kitchen API. The device token goes ONLY in the
// Authorization header; errors carry a kind and a status, never the server's
// text, the URL or the token, so nothing here can leak into a log or a screen.

import type { Strings } from "../i18n/strings";
import type { TokenRead } from "../storage/token";
import type {
  HistoryPage,
  KitchenMe,
  PinState,
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
  | "credentials_unreadable" // the saved login could not be read right now (NOT lost)
  | "client" // 4xx
  | "server"; // 5xx

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly reason?: string,
    /** A «locked» answer says how long to wait. */
    readonly retryAfterSeconds?: number
  ) {
    super(kind);
    this.name = "ApiError";
  }

  /** Worth trying again later (no connection, timeout, server trouble). */
  get retryable(): boolean {
    return (
      this.kind === "credentials_unreadable" ||
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

/**
 * What a 401 means.
 *  - "any": every 401 ends the session (the manager client, whose 401s come
 *    from Supabase with no reason).
 *  - "device": only the server's «revoked» / «unknown_device» do, and only after
 *    one retry of the same request; any other 401 (a proxy, a login wall) is
 *    just trouble reaching Milton and never signs the cook out.
 */
export type UnauthorizedPolicy = "device" | "any";

export type UnauthorizedAction = "sign_out" | "retry" | "unreachable";

/** The two reasons the server gives when the device token is really dead. */
export function isDeadDeviceReason(reason: unknown): boolean {
  return reason === "revoked" || reason === "unknown_device";
}

/** Pure: what to do with a 401 (`retried` = this was already the second try). */
export function unauthorizedAction(
  policy: UnauthorizedPolicy,
  reason: unknown,
  retried: boolean
): UnauthorizedAction {
  if (policy === "any") return "sign_out";
  if (!isDeadDeviceReason(reason)) return "unreachable";
  return retried ? "sign_out" : "retry";
}

export interface ClientDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /**
   * Optional: tells «no saved login» apart from «could not read it now». When
   * given, an unreadable store ends the request with `credentials_unreadable`
   * (a retry message), never with «sign in again».
   */
  readToken?: () => Promise<TokenRead>;
  /** Called once when an authenticated request gets a 401 that ends the session. */
  onUnauthorized: () => void | Promise<void>;
  /** Default "any". The kitchen client uses "device". */
  unauthorizedPolicy?: UnauthorizedPolicy;
  /** The company language («es», «en», «de»): the server answers in it. */
  language?: string | (() => string);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The request core shared by the kitchen and the manager clients: timeout,
 * Accept-Language, bearer header, 401 -> onUnauthorized, JSON-or-unreachable.
 */
export function createRequester(deps: ClientDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl.replace(/\/+$/, "");

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; auth?: boolean } = {},
    retried = false
  ): Promise<T> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = { Accept: "application/json" };
    const language =
      typeof deps.language === "function" ? deps.language() : deps.language;
    if (language) headers["Accept-Language"] = language;
    if (auth) {
      let token: string | null;
      if (deps.readToken) {
        const read = await deps.readToken();
        if (read.kind === "unreadable") {
          throw new ApiError("credentials_unreadable");
        }
        token = read.kind === "found" ? read.token : null;
      } else {
        token = await deps.getToken();
      }
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
      const policy = deps.unauthorizedPolicy ?? "any";
      const reason = policy === "any" ? undefined : await readReason(res);
      const action = unauthorizedAction(policy, reason, retried);
      if (action === "retry") return request<T>(method, path, opts, true);
      if (action === "unreachable") throw new ApiError("unreachable", 401);
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
      const body = data as {
        reason?: unknown;
        retryAfterSeconds?: unknown;
      } | null;
      throw new ApiError(
        res.status >= 500 ? "server" : "client",
        res.status,
        typeof body?.reason === "string" ? body.reason : undefined,
        typeof body?.retryAfterSeconds === "number"
          ? body.retryAfterSeconds
          : undefined
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

  return { request, qs };
}

async function readReason(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.json()) as { reason?: unknown } | null;
    return typeof data?.reason === "string" ? data.reason : undefined;
  } catch {
    return undefined;
  }
}

export function createApiClient(deps: ClientDeps) {
  const { request, qs } = createRequester(deps);

  return {
    redeem: (input: {
      secret: string;
      name: string;
      platform: string;
      deviceLabel: string;
      pin?: string;
    }) =>
      request<RedeemResponse>("POST", "/api/mobile/v1/kitchen/redeem", {
        body: input,
        auth: false,
      }),
    /** A cook who lost the session signs back in with code + name + PIN. */
    pinLogin: (input: {
      code: string;
      name: string;
      pin: string;
      platform: string;
      deviceLabel: string;
    }) =>
      request<RedeemResponse>("POST", "/api/mobile/v1/kitchen/pin-login", {
        body: input,
        auth: false,
      }),
    /** Sets or changes the PIN (currentPin unless there is none yet / temporary). */
    setPin: (input: { pin: string; currentPin?: string }) =>
      request<{ pin: PinState }>("POST", "/api/mobile/v1/kitchen/pin", {
        body: input,
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
    /** «Reintentar»: the server runs the unfinished message again. */
    retryReport: (reportId: string) =>
      request<{ status: "requeued" | "done" | "too_early" }>(
        "POST",
        "/api/mobile/v1/kitchen/retry",
        { body: { reportId } }
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
    case "credentials_unreadable":
      return e.credentialsUnreadable;
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
