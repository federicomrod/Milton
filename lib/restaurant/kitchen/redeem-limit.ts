// lib/restaurant/kitchen/redeem-limit.ts
//
// Small per-IP limiter for POST /api/mobile/v1/kitchen/redeem (mobile P0b,
// #430). The repo has no shared request limiter (kitchen-join counts joins in
// the database per QR), so this is a simple in-memory sliding window: best
// effort per server instance, which is enough because an invite secret is 32
// random bytes and cannot be guessed anyway. Never stores or logs a secret.

const WINDOW_MS = 60_000;
export const REDEEM_MAX_PER_WINDOW = 10;

const hits = new Map<string, number[]>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/** True when this IP is over the limit; otherwise records the attempt. */
export function isRedeemRateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= REDEEM_MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

export function resetRedeemLimitForTests(): void {
  hits.clear();
}
