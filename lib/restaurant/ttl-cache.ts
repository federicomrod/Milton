// lib/restaurant/ttl-cache.ts
//
// A tiny in-memory cache for values that rarely change (company name,
// currency, roles, a combo probe). Per server instance, short TTL, keyed
// by company/user, so nothing leaks across tenants and a change shows up
// within a minute. A failed load is never cached.

export function ttlCached<A extends unknown[], T>(
  ttlMs: number,
  keyOf: (...args: A) => string,
  load: (...args: A) => Promise<T>
): ((...args: A) => Promise<T>) & { clear: () => void } {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  const fn = (...args: A): Promise<T> => {
    const key = keyOf(...args);
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load(...args);
    store.set(key, { at: Date.now(), value });
    value.catch(() => store.delete(key));
    if (store.size > 500) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    return value;
  };
  return Object.assign(fn, { clear: () => store.clear() });
}
