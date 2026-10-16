// lib/auth/safe-next.ts
//
// The optional `next` param of the login: where to go after signing in. Only a
// same-origin RELATIVE path is accepted (it starts with a single "/"). No
// scheme, no protocol-relative "//", no backslashes or control characters (a
// browser reads "/\evil.com" as "//evil.com"), and never /auth/* (a loop).
// Anything else is null and the normal landing applies. No server-only imports:
// the proxy, the login form and the callback route all use it.

function isHostile(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "" || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Backslashes and control characters, literal or percent-encoded.
  if (isHostile(raw)) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (isHostile(decoded) || decoded.startsWith("//")) return null;
  // A login must not send the person back to login (or around the auth flow).
  if (/^\/auth(?:[/?#]|$)/i.test(raw) || /^\/auth(?:[/?#]|$)/i.test(decoded)) {
    return null;
  }
  try {
    if (
      new URL(raw, "http://same-origin.invalid").origin !==
      "http://same-origin.invalid"
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return raw;
}
