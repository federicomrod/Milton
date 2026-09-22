import { describe, it, expect } from "vitest";
import {
  encodeMethodCall,
  decodeMethodResponse,
} from "@/lib/restaurant/odoo/xmlrpc";

describe("encodeMethodCall", () => {
  it("encodes an authenticate call with string params and an empty struct", () => {
    const xml = encodeMethodCall("authenticate", [
      "mydb",
      "user@example.com",
      "secret-key",
      {},
    ]);
    expect(xml).toContain("<methodName>authenticate</methodName>");
    expect(xml).toContain("<string>mydb</string>");
    expect(xml).toContain("<string>user@example.com</string>");
    expect(xml).toContain("<string>secret-key</string>");
    expect(xml).toContain("<struct></struct>");
  });

  it("escapes reserved XML characters in string values", () => {
    const xml = encodeMethodCall("execute_kw", ["A & B <co>"]);
    expect(xml).toContain("A &amp; B &lt;co&gt;");
    expect(xml).not.toContain("A & B <co>");
  });

  it("encodes execute_kw with nested array/struct kwargs", () => {
    const xml = encodeMethodCall("execute_kw", [
      "mydb",
      2,
      "key",
      "pos.order",
      "search_read",
      [[["state", "in", ["paid", "done"]]]],
      { fields: ["id", "state"] },
    ]);
    expect(xml).toContain("<int>2</int>");
    expect(xml).toContain("<string>pos.order</string>");
    expect(xml).toContain("<string>search_read</string>");
    expect(xml).toContain("<string>state</string>");
    // Struct member names are plain text per the XML-RPC spec, not a typed value.
    expect(xml).toContain("<name>fields</name>");
  });

  it("encodes null as nil", () => {
    const xml = encodeMethodCall("m", [null]);
    expect(xml).toContain("<nil/>");
  });
});

describe("decodeMethodResponse", () => {
  it("decodes a simple int result (authenticate success → uid)", () => {
    const xml = `<?xml version='1.0'?>
      <methodResponse><params><param><value><int>7</int></value></param></params></methodResponse>`;
    const result = decodeMethodResponse(xml);
    expect(result).toEqual({ ok: true, result: 7 });
  });

  it("decodes a boolean false result (authenticate failure)", () => {
    const xml = `<?xml version='1.0'?>
      <methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>`;
    const result = decodeMethodResponse(xml);
    expect(result).toEqual({ ok: true, result: false });
  });

  it("decodes a fault response", () => {
    const xml = `<?xml version='1.0'?>
      <methodResponse><fault><value><struct>
        <member><name>faultCode</name><value><int>1</int></value></member>
        <member><name>faultString</name><value><string>Access Denied</string></value></member>
      </struct></value></fault></methodResponse>`;
    const result = decodeMethodResponse(xml);
    expect(result).toEqual({
      ok: false,
      fault: { faultCode: 1, faultString: "Access Denied" },
    });
  });

  it("decodes an array of structs shaped like a search_read result, including a many2one array and a false many2one", () => {
    const xml = `<?xml version='1.0'?>
      <methodResponse><params><param><value><array><data>
        <value><struct>
          <member><name>id</name><value><int>101</int></value></member>
          <member><name>state</name><value><string>paid</string></value></member>
          <member><name>date_order</name><value><string>2026-02-01 05:30:00</string></value></member>
          <member><name>config_id</name><value><array><data>
            <value><int>3</int></value>
            <value><string>Roma Norte</string></value>
          </data></array></value></member>
          <member><name>session_id</name><value><boolean>0</boolean></value></member>
        </struct></value>
      </data></array></value></param></params></methodResponse>`;
    const result = decodeMethodResponse(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const rows = result.result as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(101);
    expect(rows[0].state).toBe("paid");
    expect(rows[0].date_order).toBe("2026-02-01 05:30:00");
    expect(rows[0].config_id).toEqual([3, "Roma Norte"]);
    expect(rows[0].session_id).toBe(false);
  });

  it("decodes entity-escaped text back to the original characters", () => {
    const xml = `<?xml version='1.0'?>
      <methodResponse><params><param><value><string>A &amp; B &lt;co&gt;</string></value></param></params></methodResponse>`;
    const result = decodeMethodResponse(xml);
    expect(result).toEqual({ ok: true, result: "A & B <co>" });
  });
});
