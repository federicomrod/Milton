import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertOdooScope,
  assertRecordsInScope,
  buildScopedCall,
  scopedExecuteKw,
  ODOO_MODEL_COMPANY_POLICY,
  OdooCompanyScopeError,
  type OdooCompanyPolicy,
} from "@/lib/restaurant/odoo/scoped";
import type { OdooCredentials } from "@/lib/restaurant/odoo/client";
import type { XmlRpcValue } from "@/lib/restaurant/odoo/xmlrpc";

const creds: OdooCredentials = {
  baseUrl: "https://odoo.example.com",
  database: "db",
  username: "u",
  apiKey: "k",
};
const scope = { companyIds: [7, 9] };

const testRegistry: Record<string, OdooCompanyPolicy> = {
  "test.strict": "strict",
  "test.shared": "shared_or_company",
  "test.nocompany": "no_company_field",
  "test.self": "self",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function xmlOk(value: string) {
  return new Response(
    `<?xml version="1.0"?><methodResponse><params><param><value>${value}</value></param></params></methodResponse>`,
    { status: 200 }
  );
}
const emptyArray = "<array><data></data></array>";

describe("assertOdooScope", () => {
  it("accepts positive integer arrays", () => {
    expect(assertOdooScope([7])).toEqual({ companyIds: [7] });
    expect(assertOdooScope([7, 9])).toEqual({ companyIds: [7, 9] });
  });
  it.each([null, undefined, [], [0], [-3], [1.5], ["7"], [NaN], "7", 7])(
    "rejects %j",
    (bad) => {
      expect(() => assertOdooScope(bad)).toThrow(OdooCompanyScopeError);
    }
  );
});

describe("buildScopedCall — registered models × methods", () => {
  const cases: [string, string][] = [];
  for (const model of ["pos.order", "pos.order.line", "pos.config"]) {
    for (const method of ["search_read", "search_count"]) {
      cases.push([model, method]);
    }
  }

  it.each(cases)("%s.%s injects domain and context", (model, method) => {
    const callerDomain = [
      ["state", "in", ["paid", "done"]],
      ["date_order", ">=", "2026-01-01 00:00:00"],
    ];
    const out = buildScopedCall(
      model,
      method,
      [callerDomain],
      { fields: ["id", "name"], context: { lang: "es_MX" } },
      scope
    );
    const domain = out.args[0] as unknown[];
    expect(domain).toContainEqual(["company_id", "in", [7, 9]]);
    for (const clause of callerDomain) expect(domain).toContainEqual(clause);
    expect(out.kwargs.context).toEqual({
      lang: "es_MX",
      allowed_company_ids: [7, 9],
    });
    if (method === "search_read") {
      expect(out.kwargs.fields).toEqual(["id", "name", "company_id"]);
    }
  });

  it("does not duplicate company_id in fields", () => {
    const out = buildScopedCall(
      "pos.order",
      "search_read",
      [[]],
      { fields: ["id", "company_id"] },
      scope
    );
    expect(out.kwargs.fields).toEqual(["id", "company_id"]);
  });

  it("keeps a caller domain starting with | intact, ANDing the company term on top", () => {
    const callerDomain = ["|", ["a", "=", 1], ["b", "=", 2]];
    const out = buildScopedCall(
      "pos.order",
      "search_read",
      [callerDomain],
      {},
      scope
    );
    expect(out.args[0]).toEqual([
      ["company_id", "in", [7, 9]],
      "|",
      ["a", "=", 1],
      ["b", "=", 2],
    ]);
  });

  it("does not mutate caller inputs", () => {
    const domain = [["x", "=", 1]];
    const kwargs = { fields: ["id"], context: { lang: "en" } };
    buildScopedCall("pos.order", "search_read", [domain], kwargs, scope);
    expect(domain).toEqual([["x", "=", 1]]);
    expect(kwargs).toEqual({ fields: ["id"], context: { lang: "en" } });
  });

  it("res.company (self policy) filters on id", () => {
    const out = buildScopedCall(
      "res.company",
      "search_read",
      [[]],
      { fields: ["id", "name"] },
      scope
    );
    expect(out.args[0]).toEqual([["id", "in", [7, 9]]]);
    expect(out.kwargs.fields).toEqual(["id", "name"]);
  });
});

describe("buildScopedCall — policy kinds (test registry)", () => {
  it("shared_or_company uses the |/false form", () => {
    const out = buildScopedCall(
      "test.shared",
      "search_read",
      [[["name", "=", "x"]]],
      { fields: ["id"] },
      scope,
      testRegistry
    );
    expect(out.args[0]).toEqual([
      "|",
      ["company_id", "=", false],
      ["company_id", "in", [7, 9]],
      ["name", "=", "x"],
    ]);
    expect(out.kwargs.fields).toEqual(["id", "company_id"]);
  });

  it("no_company_field injects context only", () => {
    const out = buildScopedCall(
      "test.nocompany",
      "search_read",
      [[["a", "=", 1]]],
      { fields: ["id"] },
      scope,
      testRegistry
    );
    expect(out.args[0]).toEqual([["a", "=", 1]]);
    expect(out.kwargs.fields).toEqual(["id"]);
    expect(out.kwargs.context).toEqual({ allowed_company_ids: [7, 9] });
  });
});

describe("buildScopedCall — rejections", () => {
  const ok = (
    m: string,
    meth: string,
    kw: Record<string, never> | object = {}
  ) => buildScopedCall(m, meth, [[]], kw as Record<string, never>, scope);

  it("rejects an unknown model", () => {
    expect(() => ok("res.partner", "search_read")).toThrow(
      OdooCompanyScopeError
    );
  });
  it.each(["create", "write", "unlink", "read", "search", "name_get"])(
    "rejects method %s",
    (m) => {
      expect(() => ok("pos.order", m)).toThrow(OdooCompanyScopeError);
    }
  );
  it("labels write methods", () => {
    expect(() => ok("pos.order", "write")).toThrow(
      "write methods are not permitted"
    );
  });
  it.each(["allowed_company_ids", "force_company", "company_id"])(
    "rejects caller context.%s",
    (key) => {
      expect(() =>
        ok("pos.order", "search_read", { context: { [key]: [1] } })
      ).toThrow(OdooCompanyScopeError);
    }
  );
  it("rejects a non-array domain", () => {
    expect(() =>
      buildScopedCall("pos.order", "search_read", ["x"], {}, scope)
    ).toThrow(OdooCompanyScopeError);
  });
  it.each([null, undefined, { companyIds: [] }])("rejects scope %j", (s) => {
    expect(() =>
      buildScopedCall("pos.order", "search_read", [[]], {}, s as never)
    ).toThrow(OdooCompanyScopeError);
  });
  it("registry is frozen", () => {
    expect(Object.isFrozen(ODOO_MODEL_COMPANY_POLICY)).toBe(true);
  });
});

describe("assertRecordsInScope", () => {
  const rec = (id: number, company_id: unknown) => ({ id, company_id });
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes for in-scope records", () => {
    expect(() =>
      assertRecordsInScope(
        "pos.order",
        [rec(1, [7, "A"]), rec(2, [9, "B"])],
        scope
      )
    ).not.toThrow();
  });
  it("throws for a foreign company id", () => {
    expect(() =>
      assertRecordsInScope(
        "pos.order",
        [rec(1, [7, "A"]), rec(2, [8, "X"])],
        scope
      )
    ).toThrow(OdooCompanyScopeError);
  });
  it("throws for a missing company_id key", () => {
    expect(() => assertRecordsInScope("pos.order", [{ id: 1 }], scope)).toThrow(
      OdooCompanyScopeError
    );
  });
  it("throws for false on a strict model", () => {
    expect(() =>
      assertRecordsInScope("pos.order", [rec(1, false)], scope)
    ).toThrow(OdooCompanyScopeError);
  });
  it("passes for false on a shared model but still rejects foreign ids", () => {
    expect(() =>
      assertRecordsInScope("test.shared", [rec(1, false)], scope, testRegistry)
    ).not.toThrow();
    expect(() =>
      assertRecordsInScope(
        "test.shared",
        [rec(1, [8, "X"])],
        scope,
        testRegistry
      )
    ).toThrow(OdooCompanyScopeError);
  });
  it("checks res.company by id", () => {
    expect(() =>
      assertRecordsInScope("res.company", [{ id: 7 }], scope)
    ).not.toThrow();
    expect(() =>
      assertRecordsInScope("res.company", [{ id: 8 }], scope)
    ).toThrow(OdooCompanyScopeError);
  });
  it("throws on an empty scope and on non-array results", () => {
    expect(() => assertRecordsInScope("pos.order", [], null)).toThrow(
      OdooCompanyScopeError
    );
    expect(() => assertRecordsInScope("pos.order", "x", scope)).toThrow(
      OdooCompanyScopeError
    );
  });
  it("logs model/ids but no payload", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      assertRecordsInScope("pos.order", [rec(5, [8, "Secret Co"])], scope);
    } catch {
      /* expected */
    }
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("pos.order");
    expect(logged).toContain("id=5");
    expect(logged).not.toContain("Secret Co");
  });
});

describe("scopedExecuteKw — mocked RPC", () => {
  const cases: { model: string; domain: XmlRpcValue[]; fields: string[] }[] = [
    {
      model: "pos.order",
      domain: [
        ["date_order", ">=", "2026-01-01 00:00:00"],
        ["date_order", "<=", "2026-01-31 23:59:59"],
        ["state", "in", ["paid", "done", "invoiced"]],
      ],
      fields: ["id", "state", "date_order", "config_id"],
    },
    {
      model: "pos.order.line",
      domain: [["order_id", "in", [11, 12]]],
      fields: ["id", "order_id", "qty"],
    },
    {
      model: "pos.config",
      domain: [["id", "in", [3, 4]]],
      fields: ["id", "name"],
    },
  ];

  it.each(cases)(
    "$model search_read sends scoped domain + context on /xmlrpc/2/object",
    async ({ model, domain, fields }) => {
      const fetchMock = vi.fn().mockResolvedValue(xmlOk(emptyArray));
      vi.stubGlobal("fetch", fetchMock);
      await scopedExecuteKw(creds, 5, scope, model, "search_read", [domain], {
        fields,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith("/xmlrpc/2/object")).toBe(true);
      const body = String((init as RequestInit).body);
      expect(body).toContain("<name>allowed_company_ids</name>");
      expect(body).toContain(
        "<value><string>company_id</string></value><value><string>in</string></value><value><array><data><value><int>7</int></value><value><int>9</int></value></data></array></value>"
      );
      expect(body).toContain(
        "<name>allowed_company_ids</name><value><array><data><value><int>7</int></value><value><int>9</int></value></data></array></value>"
      );
      for (const term of domain as unknown[][]) {
        expect(body).toContain(
          `<value><string>${String(term[0])}</string></value>`
        );
      }
      expect(body).toContain("<string>company_id</string>");
    }
  );

  it.each([null, undefined, [], [0], [-1], [1.5], ["1"]])(
    "fails closed for scope ids %j with zero fetch calls",
    async (ids) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        scopedExecuteKw(
          creds,
          5,
          ids === null || ids === undefined
            ? (ids as never)
            : ({ companyIds: ids } as never),
          "pos.order",
          "search_read",
          [[]]
        )
      ).rejects.toBeInstanceOf(OdooCompanyScopeError);
      expect(fetchMock).toHaveBeenCalledTimes(0);
    }
  );

  it("rejects policy violations with zero fetch calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const attempts: [string, string, Record<string, never> | object][] = [
      ["res.partner", "search_read", {}],
      ["pos.order", "write", {}],
      ["pos.order", "read", {}],
      ["pos.order", "search_read", { context: { allowed_company_ids: [1] } }],
      ["pos.order", "search_read", { context: { force_company: 1 } }],
    ];
    for (const [m, meth, kw] of attempts) {
      await expect(
        scopedExecuteKw(creds, 5, scope, m, meth, [[]], kw as never)
      ).rejects.toBeInstanceOf(OdooCompanyScopeError);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
