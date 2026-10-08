import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authenticate, unsafeExecuteKw } from "@/lib/restaurant/odoo/client";
import { OdooHostNotAllowedError } from "@/lib/restaurant/odoo/allowed-hosts";

vi.mock("@/lib/restaurant/odoo/allowed-hosts", async () => {
  const actual = await vi.importActual("@/lib/restaurant/odoo/allowed-hosts");
  return {
    ...actual,
    parseAllowedHosts: vi.fn(),
  };
});

describe("Odoo client allowed-hosts integration", () => {
  const originalEnv = process.env.ODOO_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ODOO_ALLOWED_HOSTS = originalEnv;
    } else {
      delete process.env.ODOO_ALLOWED_HOSTS;
    }
    vi.restoreAllMocks();
  });

  describe("authenticate", () => {
    it("fails when env is unset and fetch is never called", async () => {
      delete process.env.ODOO_ALLOWED_HOSTS;
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(new Set());

      const fetchSpy = vi.spyOn(global, "fetch");

      await expect(
        authenticate({
          baseUrl: "https://test.odoo.com",
          database: "db",
          username: "user",
          apiKey: "key",
        })
      ).rejects.toThrow(OdooHostNotAllowedError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails when host is not in allowed list and fetch is never called", async () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(
        new Set(["allowed.odoo.com"])
      );

      const fetchSpy = vi.spyOn(global, "fetch");

      await expect(
        authenticate({
          baseUrl: "https://disallowed.odoo.com",
          database: "db",
          username: "user",
          apiKey: "key",
        })
      ).rejects.toThrow(OdooHostNotAllowedError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("calls fetch with redirect manual when host is allowed", async () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(
        new Set(["allowed.odoo.com"])
      );

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(
          new Response(
            '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
            { status: 200 }
          )
        );

      await authenticate({
        baseUrl: "https://allowed.odoo.com",
        database: "db",
        username: "user",
        apiKey: "key",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://allowed.odoo.com/xmlrpc/2/common",
        expect.objectContaining({
          redirect: "manual",
        })
      );
    });

    it("rejects a 302 response", async () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(
        new Set(["allowed.odoo.com"])
      );

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.com" },
        })
      );

      await expect(
        authenticate({
          baseUrl: "https://allowed.odoo.com",
          database: "db",
          username: "user",
          apiKey: "key",
        })
      ).rejects.toThrow("returned a redirect");
    });
  });

  describe("unsafeExecuteKw", () => {
    it("fails when env is unset and fetch is never called", async () => {
      delete process.env.ODOO_ALLOWED_HOSTS;
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(new Set());

      const fetchSpy = vi.spyOn(global, "fetch");

      await expect(
        unsafeExecuteKw(
          {
            baseUrl: "https://test.odoo.com",
            database: "db",
            username: "user",
            apiKey: "key",
          },
          5,
          "pos.order",
          "search_read",
          [[]]
        )
      ).rejects.toThrow(OdooHostNotAllowedError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails when host is not in allowed list and fetch is never called", async () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(
        new Set(["allowed.odoo.com"])
      );

      const fetchSpy = vi.spyOn(global, "fetch");

      await expect(
        unsafeExecuteKw(
          {
            baseUrl: "https://disallowed.odoo.com",
            database: "db",
            username: "user",
            apiKey: "key",
          },
          5,
          "pos.order",
          "search_read",
          [[]]
        )
      ).rejects.toThrow(OdooHostNotAllowedError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("calls fetch with redirect manual when host is allowed", async () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const { parseAllowedHosts } =
        await import("@/lib/restaurant/odoo/allowed-hosts");
      vi.mocked(parseAllowedHosts).mockReturnValue(
        new Set(["allowed.odoo.com"])
      );

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(
          new Response(
            '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
            { status: 200 }
          )
        );

      await unsafeExecuteKw(
        {
          baseUrl: "https://allowed.odoo.com",
          database: "db",
          username: "user",
          apiKey: "key",
        },
        5,
        "pos.order",
        "search_read",
        [[]]
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://allowed.odoo.com/xmlrpc/2/object",
        expect.objectContaining({
          redirect: "manual",
        })
      );
    });
  });
});
