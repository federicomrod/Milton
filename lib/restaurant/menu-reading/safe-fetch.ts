// Fetch a menu page from a URL a person typed. Server-side, so every rule
// here is about never reaching anything but a public web page:
// - https only, default port, no user:password in the URL, a host name
//   (never a raw IPv4 or IPv6 address);
// - the host must resolve to public addresses only. The check runs inside
//   the connection's own DNS lookup, so a name cannot pass the check and
//   then connect somewhere else (DNS rebinding);
// - redirects are followed by hand (at most 3) and each hop is checked
//   again with the same rules;
// - one overall timeout, and a byte cap on the body (after decompression);
// - only HTML or plain text is read.

import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";

export const MENU_FETCH_TIMEOUT_MS = 10_000;
export const MENU_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const MENU_FETCH_MAX_REDIRECTS = 3;

export class MenuFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuFetchError";
  }
}

const BLOCKED = new BlockList();
// IPv4: this network, private, CGNAT, loopback, link-local, IETF protocol,
// documentation, benchmarking, multicast, reserved, broadcast.
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
// IPv6: unspecified, loopback, NAT64, discard, documentation, unique
// local, link-local, multicast. IPv4-mapped addresses (::ffff:a.b.c.d)
// are checked as the IPv4 address they carry (see isBlockedAddress); a
// ::ffff:0:0/96 rule here would also match every plain IPv4 address,
// because BlockList compares IPv4 as mapped IPv6.
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** True when the address is not a public internet address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family === 6) {
    // An IPv4 address written inside IPv6 (::ffff:10.0.0.1) is checked as
    // the IPv4 address it carries.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return BLOCKED.check(mapped[1], "ipv4");
    return BLOCKED.check(address, "ipv6");
  }
  return true; // not an IP at all
}

/**
 * Parse and check a URL a person typed. Adds https:// when the scheme is
 * missing. Throws MenuFetchError with a message for the person.
 */
export function checkMenuUrl(raw: string): URL {
  const text = raw.trim();
  if (!text) throw new MenuFetchError("Escribe la dirección de tu menú.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new MenuFetchError("Esa dirección no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new MenuFetchError("La dirección tiene que empezar con https://");
  }
  if (url.username || url.password) {
    throw new MenuFetchError("La dirección no puede llevar usuario ni clave.");
  }
  if (url.port && url.port !== "443") {
    throw new MenuFetchError("La dirección no puede usar otro puerto.");
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  // A menu lives at a name, never at a raw IP. The URL parser has already
  // turned 2130706433, 0x7f.1 and [::ffff:127.0.0.1] into plain IP form,
  // so isIP sees every spelling of an address.
  if (isIP(host) !== 0) {
    throw new MenuFetchError(
      "Escribe la dirección con el nombre de la página, no con una IP."
    );
  }
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    throw new MenuFetchError("Esa dirección no es una página pública.");
  }
  url.hash = "";
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/** DNS lookup that refuses any non-public address. */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: LookupCallback
): void {
  const wantAll = typeof options === "object" && options?.all === true;
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, wantAll ? [] : "", undefined);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = new Error("blocked address") as NodeJS.ErrnoException;
      blocked.code = "EBLOCKED";
      return callback(blocked, wantAll ? [] : "", undefined);
    }
    if (wantAll) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}

function decoded(res: IncomingMessage): NodeJS.ReadableStream {
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") {
    return res.pipe(zlib.createGunzip());
  }
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function requestOnce(
  url: URL,
  signal: AbortSignal
): Promise<
  | { kind: "redirect"; location: string }
  | { kind: "page"; contentType: string; body: string }
> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: publicOnlyLookup as unknown as typeof dnsLookup,
        signal,
        headers: {
          "user-agent": "MiltonMenuReader/1.0 (+https://milton.app)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: "redirect", location: res.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(
            new MenuFetchError(
              `La página respondió con un error (${status}). Pega el texto del menú.`
            )
          );
          return;
        }
        const contentType = String(res.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (
          contentType &&
          contentType !== "text/html" &&
          contentType !== "application/xhtml+xml" &&
          contentType !== "text/plain"
        ) {
          res.resume();
          reject(
            new MenuFetchError(
              "Esa dirección no es una página web (puede ser un PDF o una imagen). Pega el texto del menú."
            )
          );
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MENU_FETCH_MAX_BYTES) {
          res.destroy();
          reject(new MenuFetchError("La página es demasiado grande."));
          return;
        }
        const stream = decoded(res);
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MENU_FETCH_MAX_BYTES) {
            res.destroy();
            reject(new MenuFetchError("La página es demasiado grande."));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({
            kind: "page",
            contentType: contentType || "text/html",
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
        stream.on("error", reject);
      }
    );
    req.on("error", reject);
  });
}

/** Fetch a public menu page, following up to 3 checked redirects. */
export async function fetchMenuPage(raw: string): Promise<FetchedPage> {
  let url = checkMenuUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MENU_FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MENU_FETCH_MAX_REDIRECTS; hop++) {
      const result = await requestOnce(url, controller.signal);
      if (result.kind === "page") {
        return {
          url: url.toString(),
          contentType: result.contentType,
          body: result.body,
        };
      }
      url = checkMenuUrl(new URL(result.location, url).toString());
    }
    throw new MenuFetchError("La página redirige demasiadas veces.");
  } catch (err) {
    if (err instanceof MenuFetchError) throw err;
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EBLOCKED") {
      throw new MenuFetchError("Esa dirección no es una página pública.");
    }
    if (controller.signal.aborted || code === "ABORT_ERR") {
      throw new MenuFetchError(
        "La página tardó demasiado en responder. Pega el texto del menú."
      );
    }
    throw new MenuFetchError(
      "No pude abrir esa página. Revisa la dirección o pega el texto del menú."
    );
  } finally {
    clearTimeout(timer);
  }
}
