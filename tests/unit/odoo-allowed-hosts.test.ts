import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseAllowedHosts,
  assertOdooBaseUrlAllowed,
  assertNoRedirect,
  OdooHostNotAllowedError,
} from "@/lib/restaurant/odoo/allowed-hosts";

describe("Odoo allowed-hosts guard", () => {
  const originalEnv = process.env.ODOO_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ODOO_ALLOWED_HOSTS = originalEnv;
    } else {
      delete process.env.ODOO_ALLOWED_HOSTS;
    }
  });

  describe("parseAllowedHosts", () => {
    it("returns empty Set when ODOO_ALLOWED_HOSTS is unset (fail closed)", () => {
      delete process.env.ODOO_ALLOWED_HOSTS;
      expect(parseAllowedHosts().size).toBe(0);
    });

    it("returns empty Set when ODOO_ALLOWED_HOSTS is empty string", () => {
      process.env.ODOO_ALLOWED_HOSTS = "";
      expect(parseAllowedHosts().size).toBe(0);
    });

    it("returns empty Set when ODOO_ALLOWED_HOSTS is only whitespace", () => {
      process.env.ODOO_ALLOWED_HOSTS = "   ";
      expect(parseAllowedHosts().size).toBe(0);
    });

    it("parses single hostname", () => {
      process.env.ODOO_ALLOWED_HOSTS = "staging.odoo.example.com";
      const hosts = parseAllowedHosts();
      expect(hosts.size).toBe(1);
      expect(hosts.has("staging.odoo.example.com")).toBe(true);
    });

    it("parses comma-separated hostnames", () => {
      process.env.ODOO_ALLOWED_HOSTS =
        "host1.example.com,host2.example.com,host3.example.com";
      const hosts = parseAllowedHosts();
      expect(hosts.size).toBe(3);
      expect(hosts.has("host1.example.com")).toBe(true);
      expect(hosts.has("host2.example.com")).toBe(true);
      expect(hosts.has("host3.example.com")).toBe(true);
    });

    it("trims whitespace around hostnames", () => {
      process.env.ODOO_ALLOWED_HOSTS =
        " host1.example.com , host2.example.com ";
      const hosts = parseAllowedHosts();
      expect(hosts.size).toBe(2);
      expect(hosts.has("host1.example.com")).toBe(true);
      expect(hosts.has("host2.example.com")).toBe(true);
    });

    it("lowercases hostnames", () => {
      process.env.ODOO_ALLOWED_HOSTS = "Staging.ODOO.Example.COM";
      const hosts = parseAllowedHosts();
      expect(hosts.has("staging.odoo.example.com")).toBe(true);
      expect(hosts.has("Staging.ODOO.Example.COM")).toBe(false);
    });

    it("deduplicates hostnames", () => {
      process.env.ODOO_ALLOWED_HOSTS = "example.com,EXAMPLE.COM,example.com";
      const hosts = parseAllowedHosts();
      expect(hosts.size).toBe(1);
      expect(hosts.has("example.com")).toBe(true);
    });

    it("filters out empty entries", () => {
      process.env.ODOO_ALLOWED_HOSTS =
        "host1.example.com,,host2.example.com,  ,host3.example.com";
      const hosts = parseAllowedHosts();
      expect(hosts.size).toBe(3);
    });
  });

  describe("assertOdooBaseUrlAllowed", () => {
    it("allows https URL with allowed hostname", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.odoo.example.com", allowed)
      ).not.toThrow();
    });

    it("allows https URL with allowed hostname and no trailing slash", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.odoo.example.com/", allowed)
      ).not.toThrow();
    });

    it("is case-insensitive for hostname matching", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://STAGING.ODOO.EXAMPLE.COM", allowed)
      ).not.toThrow();
    });

    it("allows port 443 explicitly", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://staging.odoo.example.com:443",
          allowed
        )
      ).not.toThrow();
    });

    it("rejects invalid URL", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() => assertOdooBaseUrlAllowed("not-a-url", allowed)).toThrow(
        OdooHostNotAllowedError
      );
      expect(() => assertOdooBaseUrlAllowed("not-a-url", allowed)).toThrow(
        "not a valid URL"
      );
    });

    it("rejects http (non-https)", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("http://staging.odoo.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("http://staging.odoo.example.com", allowed)
      ).toThrow("must use HTTPS");
    });

    it("rejects ftp and other protocols", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("ftp://staging.odoo.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("ftp://staging.odoo.example.com", allowed)
      ).toThrow("must use HTTPS");
    });

    it("rejects URL with userinfo (username)", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://user@staging.odoo.example.com",
          allowed
        )
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://user@staging.odoo.example.com",
          allowed
        )
      ).toThrow("must not contain userinfo");
    });

    it("rejects URL with userinfo (username:password)", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://user:pass@staging.odoo.example.com",
          allowed
        )
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://user:pass@staging.odoo.example.com",
          allowed
        )
      ).toThrow("must not contain userinfo");
    });

    it("rejects IPv4 literal", () => {
      const allowed = new Set(["192.168.1.1"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://192.168.1.1", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://192.168.1.1", allowed)
      ).toThrow("must not be an IP address");
    });

    it("rejects IPv6 literal", () => {
      const allowed = new Set(["[2001:db8::1]"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[2001:db8::1]", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[2001:db8::1]", allowed)
      ).toThrow("must not be an IP address");
    });

    it("rejects port other than 443", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://staging.odoo.example.com:8069",
          allowed
        )
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed(
          "https://staging.odoo.example.com:8069",
          allowed
        )
      ).toThrow("must use port 443");
    });

    it("rejects hostname not in allowed list", () => {
      const allowed = new Set(["staging.odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://evil.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://evil.example.com", allowed)
      ).toThrow("not in the allowed list");
    });

    it("rejects suffix-match attack (odoo.example.com.evil.io)", () => {
      const allowed = new Set(["odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://odoo.example.com.evil.io", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://odoo.example.com.evil.io", allowed)
      ).toThrow("not in the allowed list");
    });

    it("rejects prefix-match attack (evilodoo.example.com)", () => {
      const allowed = new Set(["odoo.example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://evilodoo.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://evilodoo.example.com", allowed)
      ).toThrow("not in the allowed list");
    });

    it("rejects subdomain when only parent is allowed", () => {
      const allowed = new Set(["example.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.example.com", allowed)
      ).toThrow("not in the allowed list");
    });

    it("gives clear error message when allowed list is empty (fail closed)", () => {
      const allowed = new Set<string>();
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.odoo.example.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://staging.odoo.example.com", allowed)
      ).toThrow("No Odoo hosts are configured");
    });
  });

  describe("assertNoRedirect", () => {
    it("allows 2xx status", () => {
      const res = new Response(null, { status: 200 });
      expect(() => assertNoRedirect(res, "https://example.com")).not.toThrow();
    });

    it("allows 4xx status", () => {
      const res = new Response(null, { status: 404 });
      expect(() => assertNoRedirect(res, "https://example.com")).not.toThrow();
    });

    it("allows 5xx status", () => {
      const res = new Response(null, { status: 500 });
      expect(() => assertNoRedirect(res, "https://example.com")).not.toThrow();
    });

    it("rejects 3xx redirect status", () => {
      const res = new Response(null, { status: 301 });
      expect(() => assertNoRedirect(res, "https://example.com")).toThrow(
        OdooHostNotAllowedError
      );
      expect(() => assertNoRedirect(res, "https://example.com")).toThrow(
        "returned a redirect"
      );
    });

    it("rejects 302 redirect", () => {
      const res = new Response(null, { status: 302 });
      expect(() => assertNoRedirect(res, "https://example.com")).toThrow(
        OdooHostNotAllowedError
      );
    });

    it("rejects 307 temporary redirect", () => {
      const res = new Response(null, { status: 307 });
      expect(() => assertNoRedirect(res, "https://example.com")).toThrow(
        OdooHostNotAllowedError
      );
    });

    it("rejects 308 permanent redirect", () => {
      const res = new Response(null, { status: 308 });
      expect(() => assertNoRedirect(res, "https://example.com")).toThrow(
        OdooHostNotAllowedError
      );
    });
  });
});
