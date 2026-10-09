import { describe, it, expect, vi, afterEach } from "vitest";
import { unsafeExecuteKw, OdooRpcError } from "@/lib/restaurant/odoo/client";
import type { OdooCredentials } from "@/lib/restaurant/odoo/client";

const creds: OdooCredentials = {
  baseUrl: "https://allowed.odoo.com",
  database: "db",
  username: "user",
  apiKey: "key",
};

const WRITE_METHODS = [
  "create",
  "write",
  "unlink",
  "copy",
  "action_confirm",
  "button_validate",
  "execute",
  "call",
] as const;

describe("unsafeExecuteKw read-only allowlist", () => {
  const originalEnv = process.env.ODOO_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ODOO_ALLOWED_HOSTS = originalEnv;
    } else {
      delete process.env.ODOO_ALLOWED_HOSTS;
    }
    vi.restoreAllMocks();
  });

  it.each(WRITE_METHODS)(
    "rejects %s before fetch (even when no host is allowed)",
    async (method) => {
      delete process.env.ODOO_ALLOWED_HOSTS;
      const fetchSpy = vi.spyOn(global, "fetch");

      let thrown: unknown;
      try {
        await unsafeExecuteKw(creds, 5, "pos.order", method, [[]]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(OdooRpcError);
      const rpc = thrown as OdooRpcError;
      expect(rpc.faultCode).toBe("readonly");
      expect(rpc.message).toBe(
        `Odoo method not permitted (read-only client): ${method}`
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it.each(["search_read", "search_count", "fields_get"] as const)(
    "passes %s through to fetch",
    async (method) => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const inner =
        method === "search_count"
          ? "<int>0</int>"
          : "<array><data></data></array>";
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(
          new Response(
            `<?xml version="1.0"?><methodResponse><params><param><value>${inner}</value></param></params></methodResponse>`,
            { status: 200 }
          )
        );

      await unsafeExecuteKw(creds, 5, "pos.order", method, [[]]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://allowed.odoo.com/xmlrpc/2/object",
        expect.objectContaining({ method: "POST", redirect: "manual" })
      );
    }
  );
});
