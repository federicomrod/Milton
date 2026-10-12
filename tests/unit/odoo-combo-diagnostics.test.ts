import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  assertOdooReadOnlyMethod,
  isOdooReadOnlyMethod,
  ODOO_READ_ONLY_METHODS,
} from "@/lib/restaurant/odoo/read-only-methods";
import {
  buildAnySetDomain,
  canAccessOdooComboDiagnostics,
  inspectPosOrderLineFields,
  sanitizeDiagnosticLine,
  sanitizeOdooServerVersion,
} from "@/lib/restaurant/odoo/combo-diagnostics";
import {
  buildScopedCall,
  OdooCompanyScopeError,
} from "@/lib/restaurant/odoo/scoped";
import { unsafeExecuteKw } from "@/lib/restaurant/odoo/client";

const WRITE_METHODS = [
  "create",
  "write",
  "unlink",
  "copy",
  "action_confirm",
  "action_archive",
  "button_validate",
  "execute",
  "call",
] as const;

describe("Odoo read-only allowlist", () => {
  it("allows only fields_get, search_count, search_read, and read", () => {
    expect([...ODOO_READ_ONLY_METHODS].sort()).toEqual([
      "fields_get",
      "read",
      "search_count",
      "search_read",
    ]);
  });

  it.each(["fields_get", "search_count", "search_read", "read"] as const)(
    "permits %s",
    (method) => {
      expect(isOdooReadOnlyMethod(method)).toBe(true);
      expect(() => assertOdooReadOnlyMethod(method)).not.toThrow();
    }
  );

  it.each(WRITE_METHODS)("blocks write/action method %s", (method) => {
    expect(isOdooReadOnlyMethod(method)).toBe(false);
    expect(() => assertOdooReadOnlyMethod(method)).toThrow(
      "write methods are not permitted"
    );
  });

  it("blocks an unknown action_* method", () => {
    expect(() => assertOdooReadOnlyMethod("action_pos_order_paid")).toThrow(
      "write methods are not permitted"
    );
  });

  it("buildScopedCall refuses write methods", () => {
    const scope = { companyIds: [1] };
    expect(() =>
      buildScopedCall("pos.order.line", "write", [[]], {}, scope)
    ).toThrow(OdooCompanyScopeError);
    expect(() =>
      buildScopedCall("pos.order.line", "write", [[]], {}, scope)
    ).toThrow("write methods are not permitted");
  });

  it("unsafeExecuteKw refuses write methods before fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    await expect(
      unsafeExecuteKw(
        {
          baseUrl: "https://allowed.odoo.com",
          database: "db",
          username: "u",
          apiKey: "k",
        },
        1,
        "pos.order",
        "unlink",
        [[]]
      )
    ).rejects.toMatchObject({
      name: "OdooRpcError",
      faultCode: "readonly",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("canAccessOdooComboDiagnostics", () => {
  it("allows owner, admin, and Milton admin", () => {
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: "owner" })
    ).toBe(true);
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: "admin" })
    ).toBe(true);
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: true, role: "member" })
    ).toBe(true);
  });

  it("denies member, viewer, manager, and a missing role", () => {
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: "member" })
    ).toBe(false);
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: "viewer" })
    ).toBe(false);
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: "manager" })
    ).toBe(false);
    expect(
      canAccessOdooComboDiagnostics({ isMiltonAdmin: false, role: null })
    ).toBe(false);
  });
});

describe("combo field inspection", () => {
  it("reports missing combo fields as false and lists custom attribute fields", () => {
    const flags = inspectPosOrderLineFields({
      qty: { type: "float", string: "Quantity" },
      custom_attribute_value_ids: {
        type: "one2many",
        string: "Custom Attributes",
      },
      x_studio_modifier_note: { type: "char", string: "Modifier" },
    });
    expect(flags).toEqual({
      combo_parent_id: false,
      combo_line_ids: false,
      combo_item_id: false,
      attribute_value_ids: false,
      custom_attribute_fields: [
        {
          name: "custom_attribute_value_ids",
          type: "one2many",
          label: "Custom Attributes",
        },
        {
          name: "x_studio_modifier_note",
          type: "char",
          label: "Modifier",
        },
      ],
    });
  });

  it("reports present combo fields", () => {
    const flags = inspectPosOrderLineFields({
      combo_parent_id: { type: "many2one" },
      combo_line_ids: { type: "one2many" },
      combo_item_id: { type: "many2one" },
      attribute_value_ids: { type: "many2many" },
    });
    expect(flags.combo_parent_id).toBe(true);
    expect(flags.combo_line_ids).toBe(true);
    expect(flags.combo_item_id).toBe(true);
    expect(flags.attribute_value_ids).toBe(true);
    expect(flags.custom_attribute_fields).toEqual([]);
  });

  it("treats a non-object fields_get as no fields", () => {
    expect(inspectPosOrderLineFields(null).combo_parent_id).toBe(false);
    expect(inspectPosOrderLineFields([]).custom_attribute_fields).toEqual([]);
  });
});

describe("sanitize helpers", () => {
  it("keeps only version keys", () => {
    expect(
      sanitizeOdooServerVersion({
        server_version: "18.0+e",
        server_serie: "18.0",
        protocol_version: 1,
        secret: "nope",
      })
    ).toEqual({
      server_version: "18.0+e",
      server_serie: "18.0",
      protocol_version: 1,
    });
    expect(sanitizeOdooServerVersion("18")).toBeNull();
  });

  it("sanitizes a line and ignores unknown payload keys", () => {
    const line = sanitizeDiagnosticLine(
      {
        id: 9,
        full_product_name: "Burger combo",
        qty: 1,
        price_unit: 12.5,
        price_subtotal_incl: 14,
        company_id: [7, "Los Ranchos"],
        combo_parent_id: [3, "Parent"],
        api_key: "secret",
      },
      ["combo_parent_id"]
    );
    expect(line).toEqual({
      id: 9,
      full_product_name: "Burger combo",
      qty: 1,
      price_unit: 12.5,
      price_subtotal_incl: 14,
      company_id: { id: 7, name: "Los Ranchos" },
      combo_parent_id: 3,
    });
    expect(JSON.stringify(line)).not.toContain("secret");
  });

  it("builds a prefix-OR domain for attribute fields", () => {
    expect(buildAnySetDomain(["attribute_value_ids"])).toEqual([
      ["attribute_value_ids", "!=", false],
    ]);
    expect(
      buildAnySetDomain(["attribute_value_ids", "custom_attribute_value_ids"])
    ).toEqual([
      "|",
      ["attribute_value_ids", "!=", false],
      ["custom_attribute_value_ids", "!=", false],
    ]);
  });
});

describe("GET /api/restaurant/pos/odoo-combo-diagnostics — role check", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects a signed-in member with 403", async () => {
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {},
        companyId: "co-1",
        userId: "user-123",
      }),
    }));
    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("@/lib/restaurant/cost-workbook/reset-auth", () => ({
      loadCompanyMembershipRole: vi.fn().mockResolvedValue({ role: "member" }),
    }));
    const loadSession = vi.fn();
    vi.doMock("@/lib/restaurant/odoo/load-connection", () => ({
      loadOdooSession: loadSession,
    }));

    const { GET } =
      await import("@/app/api/restaurant/pos/odoo-combo-diagnostics/route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("rejects when the membership role cannot be loaded", async () => {
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {},
        companyId: "co-1",
        userId: "user-123",
      }),
    }));
    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("@/lib/restaurant/cost-workbook/reset-auth", () => ({
      loadCompanyMembershipRole: vi
        .fn()
        .mockRejectedValue(new Error('role "authenticator" does not exist')),
    }));

    const { GET } =
      await import("@/app/api/restaurant/pos/odoo-combo-diagnostics/route");
    const response = await GET();
    expect(response.status).toBe(403);
  });
});

describe("combo diagnostics route source", () => {
  const src = readFileSync(
    join(
      process.cwd(),
      "app/api/restaurant/pos/odoo-combo-diagnostics/route.ts"
    ),
    "utf8"
  );

  it("checks the role before loading the Odoo session", () => {
    const roleAt = src.indexOf("canAccessOdooComboDiagnostics({");
    const sessionAt = src.indexOf("loadOdooSession(\n      supabase");
    expect(roleAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(roleAt);
  });
});
