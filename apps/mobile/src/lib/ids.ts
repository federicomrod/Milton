// One id per item, made BEFORE the first attempt and reused by every retry, so
// the server never stores the same item twice. Uniqueness is all it needs
// (the server also scopes it to the cook), so no secure random is required.

const HEX = "0123456789abcdef";

export function newClientRef(rand: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += HEX[Math.floor(rand() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
  }
  return out;
}
