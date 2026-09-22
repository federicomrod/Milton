// lib/restaurant/odoo/client.ts
//
// Thin Odoo XML-RPC client: authenticate() + executeKw(). No env var
// access here — credentials are passed in explicitly by the caller (the
// sync API route), which is the only place that should know where a
// secret comes from. Keeps this module trivially unit-testable with a
// mocked fetch.

import { encodeMethodCall, decodeMethodResponse } from "./xmlrpc";
import type { XmlRpcValue } from "./xmlrpc";

export interface OdooCredentials {
  /** e.g. "https://pilot-restaurant.odoo.com" — no trailing slash. */
  baseUrl: string;
  database: string;
  username: string;
  /** Odoo API key, used in place of a password. Never logged. */
  apiKey: string;
}

// Network calls to a third-party instance should never hang indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

export class OdooAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooAuthenticationError";
  }
}

export class OdooRpcError extends Error {
  faultCode: number | string;
  constructor(message: string, faultCode: number | string) {
    super(message);
    this.name = "OdooRpcError";
    this.faultCode = faultCode;
  }
}

async function postXmlRpc(url: string, body: string): Promise<XmlRpcValue> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new OdooRpcError(
      `Odoo XML-RPC HTTP ${res.status} from ${url}`,
      res.status
    );
  }
  const xml = await res.text();
  const decoded = decodeMethodResponse(xml);
  if (!decoded.ok) {
    throw new OdooRpcError(decoded.fault.faultString, decoded.fault.faultCode);
  }
  return decoded.result;
}

/**
 * Authenticates against /xmlrpc/2/common. Returns the numeric uid on
 * success. Odoo returns the literal boolean `false` (never a fault) on
 * bad credentials, so that case is checked explicitly.
 */
export async function authenticate(creds: OdooCredentials): Promise<number> {
  const url = `${creds.baseUrl}/xmlrpc/2/common`;
  const body = encodeMethodCall("authenticate", [
    creds.database,
    creds.username,
    creds.apiKey,
    {},
  ]);
  const result = await postXmlRpc(url, body);
  if (result === false || typeof result !== "number") {
    throw new OdooAuthenticationError(
      "Odoo authentication failed — check database name, username, and API key."
    );
  }
  return result;
}

/**
 * Calls execute_kw on /xmlrpc/2/object — the general-purpose model-method
 * RPC every other Odoo operation goes through (search_read, etc.).
 */
export async function executeKw(
  creds: OdooCredentials,
  uid: number,
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs: Record<string, XmlRpcValue> = {}
): Promise<XmlRpcValue> {
  const url = `${creds.baseUrl}/xmlrpc/2/object`;
  const body = encodeMethodCall("execute_kw", [
    creds.database,
    uid,
    creds.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
  return postXmlRpc(url, body);
}
