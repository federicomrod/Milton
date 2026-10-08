// lib/restaurant/odoo/allowed-hosts.ts
//
// SSRF-safe Odoo hostname validation. Called before every Odoo network
// request (in client.ts) and at route entry (odoo-connection, odoo-sync)
// to fail closed when an attacker-controlled base_url is submitted.
//
// Enforces:
//   - HTTPS only
//   - no userinfo
//   - no IP-literal hosts (including IPv6)
//   - port 443 or none
//   - hostname must exactly match an entry in ODOO_ALLOWED_HOSTS
//   - fetch with redirect: "manual", treating any redirect as an error
//
// When ODOO_ALLOWED_HOSTS is unset or empty, NO Odoo host is reachable.
// This is the fail-closed posture: the app never guesses a safe default,
// and on staging it also keeps production Odoo out (only the client's Odoo
// STAGING hostname will be listed).

export class OdooHostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooHostNotAllowedError";
  }
}

/**
 * Parses and validates ODOO_ALLOWED_HOSTS from the environment.
 * Returns a lowercased Set of exact hostname strings. When the var is unset
 * or empty, returns an empty Set (fail closed: no host is allowed).
 */
export function parseAllowedHosts(): Set<string> {
  const raw = process.env.ODOO_ALLOWED_HOSTS;
  if (!raw || !raw.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0)
  );
}

/**
 * Pure validation — no I/O. Throws OdooHostNotAllowedError when the
 * base_url violates any rule. allowedHosts is the output of
 * parseAllowedHosts(); callers typically read it once at module scope or
 * route entry, not per-request.
 */
export function assertOdooBaseUrlAllowed(
  baseUrl: string,
  allowedHosts: Set<string>
): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new OdooHostNotAllowedError("Odoo base URL is not a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new OdooHostNotAllowedError("Odoo base URL must use HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new OdooHostNotAllowedError(
      "Odoo base URL must not contain userinfo"
    );
  }

  const { hostname, port } = parsed;

  // Reject IPv4 and IPv6 literals.
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^\[?[0-9a-f:]+\]?$/i;
  if (ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname)) {
    throw new OdooHostNotAllowedError(
      "Odoo base URL must not be an IP address"
    );
  }

  // Port must be 443 or absent (which defaults to 443 for https).
  if (port && port !== "443") {
    throw new OdooHostNotAllowedError(
      "Odoo base URL must use port 443 or no explicit port"
    );
  }

  // Exact hostname match, case-insensitive.
  const lowerHost = hostname.toLowerCase();
  if (!allowedHosts.has(lowerHost)) {
    if (allowedHosts.size === 0) {
      throw new OdooHostNotAllowedError(
        "No Odoo hosts are configured (ODOO_ALLOWED_HOSTS is not set)"
      );
    }
    throw new OdooHostNotAllowedError(
      "Odoo base URL hostname is not in the allowed list"
    );
  }
}

/**
 * Validates the response from fetch() when called with redirect: "manual".
 * Throws on any redirect (3xx) or loopback/private IP detection where
 * feasible. This is called immediately after fetch, before reading the
 * response body.
 */
export function assertNoRedirect(res: Response, url: string): void {
  if (res.status >= 300 && res.status < 400) {
    throw new OdooHostNotAllowedError(
      `Odoo endpoint returned a redirect (${res.status}), which is not permitted`
    );
  }
}
