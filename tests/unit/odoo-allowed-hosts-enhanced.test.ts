import { describe, it, expect, afterEach } from "vitest";
import {
  parseAllowedHosts,
  assertOdooBaseUrlAllowed,
  OdooHostNotAllowedError,
} from "@/lib/restaurant/odoo/allowed-hosts";

describe("Odoo allowed-hosts enhanced validation", () => {
  describe("IPv4 literals", () => {
    it("rejects decimal IPv4", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://192.0.2.1", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://192.0.2.1", allowed)
      ).toThrow("IPv4");
    });

    it("rejects hex IPv4 with 0x prefix", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://0xc0.0x00.0x02.0x01", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://0xc0.0x00.0x02.0x01", allowed)
      ).toThrow("IPv4");
    });

    it("rejects mixed hex notation", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://0xc0.0.2.1", allowed)
      ).toThrow(OdooHostNotAllowedError);
    });
  });

  describe("IPv6 literals", () => {
    it("rejects standard IPv6", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[2001:db8::1]", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[2001:db8::1]", allowed)
      ).toThrow("IPv6");
    });

    it("rejects IPv4-mapped IPv6", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[::ffff:192.0.2.1]", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://[::ffff:192.0.2.1]", allowed)
      ).toThrow("IPv6");
    });

    it("rejects compressed IPv6", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() => assertOdooBaseUrlAllowed("https://[::1]", allowed)).toThrow(
        OdooHostNotAllowedError
      );
    });
  });

  describe("hostname validation", () => {
    it("rejects trailing dot in hostname", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://allowed.odoo.com.", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://allowed.odoo.com.", allowed)
      ).toThrow("trailing dot");
    });

    it("allows exact hostname match", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://allowed.odoo.com", allowed)
      ).not.toThrow();
    });

    it("allows case-insensitive match", () => {
      const allowed = new Set(["allowed.odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://ALLOWED.ODOO.COM", allowed)
      ).not.toThrow();
    });

    it("rejects subdomain when not in allowlist", () => {
      const allowed = new Set(["odoo.com"]);
      expect(() =>
        assertOdooBaseUrlAllowed("https://sub.odoo.com", allowed)
      ).toThrow(OdooHostNotAllowedError);
      expect(() =>
        assertOdooBaseUrlAllowed("https://sub.odoo.com", allowed)
      ).toThrow("not in the allowed list");
    });
  });

  describe("parseAllowedHosts", () => {
    const originalEnv = process.env.ODOO_ALLOWED_HOSTS;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.ODOO_ALLOWED_HOSTS = originalEnv;
      } else {
        delete process.env.ODOO_ALLOWED_HOSTS;
      }
    });

    it("returns empty set when env is unset", () => {
      delete process.env.ODOO_ALLOWED_HOSTS;
      const result = parseAllowedHosts();
      expect(result.size).toBe(0);
    });

    it("returns empty set when env is empty string", () => {
      process.env.ODOO_ALLOWED_HOSTS = "";
      const result = parseAllowedHosts();
      expect(result.size).toBe(0);
    });

    it("parses single hostname", () => {
      process.env.ODOO_ALLOWED_HOSTS = "allowed.odoo.com";
      const result = parseAllowedHosts();
      expect(result).toEqual(new Set(["allowed.odoo.com"]));
    });

    it("parses multiple hostnames", () => {
      process.env.ODOO_ALLOWED_HOSTS = "a.odoo.com,b.odoo.com,c.odoo.com";
      const result = parseAllowedHosts();
      expect(result).toEqual(
        new Set(["a.odoo.com", "b.odoo.com", "c.odoo.com"])
      );
    });

    it("trims whitespace and lowercases", () => {
      process.env.ODOO_ALLOWED_HOSTS = " A.ODOO.COM , B.Odoo.COM ";
      const result = parseAllowedHosts();
      expect(result).toEqual(new Set(["a.odoo.com", "b.odoo.com"]));
    });
  });
});
