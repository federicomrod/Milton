// lib/restaurant/odoo/xmlrpc.ts
//
// Minimal XML-RPC request encoder / response decoder for talking to Odoo's
// /xmlrpc/2/common and /xmlrpc/2/object endpoints.
//
// Why hand-rolled instead of a library: the project has zero XML
// dependencies today, and XML-RPC's value grammar is small and fixed
// (string, int, double, boolean, array, struct, nil — Odoo never sends
// base64 or dateTime.iso8601 for the calls this module makes; Datetime
// fields come back as plain <string> values in Odoo's own
// "YYYY-MM-DD HH:MM:SS" UTC convention). This module implements exactly
// that grammar, nothing more, and is covered by unit tests against
// fixture XML rather than a live server.
//
// Pure module: no network I/O, no environment access. lib/restaurant/odoo/client.ts
// is the only caller and owns the actual HTTP requests.

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type XmlRpcValue =
  | string
  | number
  | boolean
  | null
  | XmlRpcValue[]
  | { [key: string]: XmlRpcValue };

// ---------------------------------------------------------------------------
// Encoding (request)
// ---------------------------------------------------------------------------

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeValue(value: XmlRpcValue): string {
  if (value === null || value === undefined) {
    return "<value><nil/></value>";
  }
  if (typeof value === "string") {
    return `<value><string>${escapeXmlText(value)}</string></value>`;
  }
  if (typeof value === "boolean") {
    return `<value><boolean>${value ? "1" : "0"}</boolean></value>`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) < 2 ** 31) {
      return `<value><int>${value}</int></value>`;
    }
    return `<value><double>${value}</double></value>`;
  }
  if (Array.isArray(value)) {
    const items = value.map(encodeValue).join("");
    return `<value><array><data>${items}</data></array></value>`;
  }
  // Plain object → struct.
  const members = Object.entries(value)
    .map(
      ([k, v]) =>
        `<member><name>${escapeXmlText(k)}</name>${encodeValue(v)}</member>`
    )
    .join("");
  return `<value><struct>${members}</struct></value>`;
}

/**
 * Builds the XML body for a methodCall request.
 */
export function encodeMethodCall(
  methodName: string,
  params: XmlRpcValue[]
): string {
  const paramsXml = params
    .map((p) => `<param>${encodeValue(p)}</param>`)
    .join("");
  return (
    `<?xml version="1.0"?>` +
    `<methodCall><methodName>${escapeXmlText(methodName)}</methodName>` +
    `<params>${paramsXml}</params></methodCall>`
  );
}

// ---------------------------------------------------------------------------
// Decoding (response) — minimal generic XML tree parser, then a
// value-grammar interpreter on top of it. Odoo's XML-RPC responses are
// always well-formed server-generated XML with no attributes on the tags
// this module cares about, so a regex-based tokenizer is sufficient and
// avoids adding an XML parsing dependency.
// ---------------------------------------------------------------------------

interface XmlNode {
  tag: string;
  children: XmlNode[];
  text: string;
}

const TAG_RE = /<(\/?)([a-zA-Z0-9_.:-]+)(?:\s[^>]*)?\s*(\/?)>/g;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Parses a well-formed XML fragment into a single root XmlNode. Strips the
 * XML declaration and any leading/trailing whitespace/comments first.
 */
export function parseXml(xml: string): XmlNode {
  const cleaned = xml
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  type Frame = { node: XmlNode };
  const root: XmlNode = { tag: "#root", children: [], text: "" };
  const stack: Frame[] = [{ node: root }];

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(cleaned)) !== null) {
    const [full, closing, tag, selfClosing] = match;
    const textBefore = cleaned.slice(lastIndex, match.index);
    if (textBefore) {
      stack[stack.length - 1].node.text += decodeXmlEntities(textBefore);
    }
    lastIndex = match.index + full.length;

    if (closing) {
      // </tag> — pop.
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node: XmlNode = { tag, children: [], text: "" };
    stack[stack.length - 1].node.children.push(node);
    if (!selfClosing) {
      stack.push({ node });
    }
  }

  // Well-formed XML-RPC response has exactly one top-level child.
  return root.children[0] ?? root;
}

function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

/**
 * Interprets a <value> node per the XML-RPC value grammar. An untyped
 * value (no recognized child tag, just text) defaults to string per spec.
 */
function valueNodeToJs(valueNode: XmlNode): XmlRpcValue {
  const typed = valueNode.children[0];
  if (!typed) {
    return decodeXmlEntities(valueNode.text.trim());
  }

  switch (typed.tag) {
    case "string":
      return typed.text;
    case "int":
    case "i4":
      return parseInt(typed.text.trim(), 10);
    case "double":
      return parseFloat(typed.text.trim());
    case "boolean":
      return typed.text.trim() === "1";
    case "nil":
      return null;
    case "dateTime.iso8601":
    case "base64":
      // Not produced by any call this module makes today; surface as the
      // raw string rather than guessing a conversion.
      return typed.text;
    case "array": {
      const data = findChild(typed, "data");
      const values = data ? data.children.filter((c) => c.tag === "value") : [];
      return values.map(valueNodeToJs);
    }
    case "struct": {
      const result: Record<string, XmlRpcValue> = {};
      for (const member of typed.children.filter((c) => c.tag === "member")) {
        const nameNode = findChild(member, "name");
        const valNode = findChild(member, "value");
        if (nameNode && valNode) {
          result[nameNode.text] = valueNodeToJs(valNode);
        }
      }
      return result;
    }
    default:
      return decodeXmlEntities(typed.text.trim());
  }
}

export interface XmlRpcFault {
  faultCode: number | string;
  faultString: string;
}

export type MethodResponse =
  | { ok: true; result: XmlRpcValue }
  | { ok: false; fault: XmlRpcFault };

/**
 * Parses a full <methodResponse> XML document into either a result value
 * or a fault. Never throws on well-formed fault responses — a fault is
 * data, not a parse error.
 */
export function decodeMethodResponse(xml: string): MethodResponse {
  const root = parseXml(xml);
  if (root.tag !== "methodResponse") {
    throw new Error(
      `xmlrpc: expected <methodResponse> root, got <${root.tag}>`
    );
  }

  const fault = findChild(root, "fault");
  if (fault) {
    const valueNode = findChild(fault, "value");
    const decoded = valueNode ? valueNodeToJs(valueNode) : {};
    const faultObj =
      typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
        ? (decoded as Record<string, XmlRpcValue>)
        : {};
    return {
      ok: false,
      fault: {
        faultCode: (faultObj.faultCode as number | string) ?? -1,
        faultString:
          (faultObj.faultString as string) ?? "Unknown XML-RPC fault",
      },
    };
  }

  const params = findChild(root, "params");
  const param = params ? findChild(params, "param") : undefined;
  const valueNode = param ? findChild(param, "value") : undefined;
  if (!valueNode) {
    throw new Error("xmlrpc: methodResponse has neither <fault> nor <params>");
  }
  return { ok: true, result: valueNodeToJs(valueNode) };
}
