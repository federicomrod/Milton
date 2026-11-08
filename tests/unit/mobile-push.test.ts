import { describe, expect, it, vi } from "vitest";
import {
  DAILY_CAP,
  DEFAULT_PREFS,
  dailyKey,
  decide,
  isQuietHour,
  localParts,
  pendingInvoicesKey,
  validExpoToken,
  validHour,
  validTimezone,
  type PushPrefs,
} from "@/lib/restaurant/push/policy";
import { parsePrefsPatch } from "@/lib/restaurant/push/prefs-input";
import { dailyMessage, invoicesMessage } from "@/lib/restaurant/push/copy";
import {
  EXPO_PUSH_URL,
  isDeadToken,
  isPushEnabled,
  sendExpoPush,
} from "@/lib/restaurant/push/sender";
import { dispatchPush } from "@/lib/restaurant/push/dispatch";

const prefs = (over: Partial<PushPrefs> = {}): PushPrefs => ({
  ...DEFAULT_PREFS,
  timezone: "America/Mexico_City",
  ...over,
});
// 14:00 UTC = 08:00 in Mexico City (UTC-6, no DST since 2022).
const AT_8 = new Date("2026-11-10T14:00:00Z");
const AT_23 = new Date("2026-11-11T05:00:00Z"); // 23:00 local on the 10th

describe("local time and quiet hours", () => {
  it("reads the local date and hour in the person's timezone", () => {
    expect(localParts(AT_8, "America/Mexico_City")).toEqual({
      date: "2026-11-10",
      hour: 8,
    });
    expect(localParts(AT_23, "America/Mexico_City")).toEqual({
      date: "2026-11-10",
      hour: 23,
    });
    expect(localParts(AT_23, "Europe/Berlin").date).toBe("2026-11-11");
  });
  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    expect(localParts(AT_8, "Not/AZone")).toEqual({
      date: "2026-11-10",
      hour: 14,
    });
  });
  it("quiet hours wrap midnight; equal start and end means none", () => {
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(3, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(12, 22, 7)).toBe(false);
    expect(isQuietHour(12, 13, 15)).toBe(false);
    expect(isQuietHour(14, 13, 15)).toBe(true);
    expect(isQuietHour(2, 5, 5)).toBe(false);
  });
});

describe("decide", () => {
  const base = { now: AT_8, prefs: prefs(), sentToday: 0, duplicate: false };
  it("sends the daily summary in its own hour", () => {
    expect(decide({ ...base, category: "daily" })).toEqual({ send: true });
  });
  it("waits for the daily hour", () => {
    expect(
      decide({ ...base, category: "daily", prefs: prefs({ dailyHour: 9 }) })
    ).toEqual({ send: false, why: "not_time" });
  });
  it("never sends in quiet hours, critical included", () => {
    expect(decide({ ...base, category: "critical", now: AT_23 })).toEqual({
      send: false,
      why: "quiet",
    });
    expect(decide({ ...base, category: "daily", now: AT_23 })).toEqual({
      send: false,
      why: "quiet",
    });
  });
  it("respects each switch", () => {
    expect(
      decide({
        ...base,
        category: "daily",
        prefs: prefs({ dailyEnabled: false }),
      })
    ).toEqual({ send: false, why: "disabled" });
    expect(
      decide({
        ...base,
        category: "critical",
        prefs: prefs({ criticalEnabled: false }),
      })
    ).toEqual({ send: false, why: "disabled" });
    // The other category is unaffected.
    expect(
      decide({
        ...base,
        category: "critical",
        prefs: prefs({ dailyEnabled: false }),
      })
    ).toEqual({ send: true });
  });
  it("stops at the daily cap", () => {
    expect(
      decide({ ...base, category: "critical", sentToday: DAILY_CAP - 1 })
    ).toEqual({ send: true });
    expect(
      decide({ ...base, category: "critical", sentToday: DAILY_CAP })
    ).toEqual({ send: false, why: "cap" });
  });
  it("never repeats a notification already sent", () => {
    expect(decide({ ...base, category: "critical", duplicate: true })).toEqual({
      send: false,
      why: "duplicate",
    });
  });
});

describe("dedupe keys", () => {
  it("one daily summary per person per local day", () => {
    expect(dailyKey("u1", "2026-11-10")).toBe(dailyKey("u1", "2026-11-10"));
    expect(dailyKey("u1", "2026-11-10")).not.toBe(dailyKey("u1", "2026-11-11"));
    expect(dailyKey("u1", "2026-11-10")).not.toBe(dailyKey("u2", "2026-11-10"));
  });
  it("the pending-invoices alert changes only when the set changes, whatever the order", () => {
    expect(pendingInvoicesKey("u", ["b", "a"])).toBe(
      pendingInvoicesKey("u", ["a", "b"])
    );
    expect(pendingInvoicesKey("u", ["a"])).not.toBe(
      pendingInvoicesKey("u", ["a", "b"])
    );
  });
});

describe("input validation", () => {
  it("accepts Expo tokens only", () => {
    expect(validExpoToken("ExponentPushToken[abc_DEF-123]")).toBe(true);
    expect(validExpoToken("ExpoPushToken[abc]")).toBe(true);
    for (const bad of [
      "",
      "abc",
      "ExponentPushToken[]",
      "ExponentPushToken[a b]",
      5,
      null,
      "x".repeat(300),
    ])
      expect(validExpoToken(bad)).toBe(false);
  });
  it("hours are whole numbers 0-23, timezones are real", () => {
    expect(validHour(0) && validHour(23)).toBe(true);
    for (const bad of [-1, 24, 7.5, "8", null])
      expect(validHour(bad)).toBe(false);
    expect(validTimezone("Europe/Berlin")).toBe(true);
    for (const bad of ["", "Mars/Base", 5, "x".repeat(70)])
      expect(validTimezone(bad)).toBe(false);
  });
  it("a patch is accepted whole or refused whole", () => {
    expect(
      parsePrefsPatch({ dailyEnabled: false, quietStart: 21, timezone: "UTC" })
    ).toEqual({
      daily_enabled: false,
      quiet_start: 21,
      timezone: "UTC",
    });
    expect(parsePrefsPatch({ dailyEnabled: "no" })).toBeNull();
    expect(parsePrefsPatch({ dailyEnabled: true, quietEnd: 25 })).toBeNull();
    expect(parsePrefsPatch({ role: "owner", user_id: "x" })).toEqual({});
  });
});

describe("what the notification says", () => {
  it("shows only figures the server computed, never 0 for a missing one", () => {
    const m = dailyMessage({
      lang: "es",
      currency: "USD",
      salesYesterday: 1840,
      profitMonth: null,
    });
    expect(m.body).toContain("1,840");
    expect(m.body).not.toMatch(/Ganancia/);
    expect(m.data).toEqual({ screen: "inicio" });
    const none = dailyMessage({
      lang: "es",
      currency: "USD",
      salesYesterday: null,
      profitMonth: null,
    });
    expect(none.body).not.toMatch(/\d/);
    expect(JSON.stringify(none)).not.toMatch(/\$0\b/);
  });
  it("speaks es, en and de and opens Costos for invoices", () => {
    const one = invoicesMessage({ lang: "en", count: 1 });
    const many = invoicesMessage({ lang: "de", count: 3 });
    expect(one.body).toMatch(/1 invoice/);
    expect(many.body).toMatch(/3 Rechnungen/);
    expect(one.data.screen).toBe("costos");
  });
});

describe("sender", () => {
  it("is off unless PUSH_ENABLED=1", () => {
    expect(isPushEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isPushEnabled({ PUSH_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isPushEnabled({ PUSH_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)
    ).toBe(true);
  });
  it("posts to Expo and maps tickets; a failed call never throws", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
        ],
      }),
    });
    const msg = {
      to: "ExponentPushToken[a]",
      title: "t",
      body: "b",
      data: {},
      sound: "default" as const,
      priority: "high" as const,
    };
    const r = await sendExpoPush(
      [msg, { ...msg, to: "ExponentPushToken[b]" }],
      { fetchImpl: f as never, accessToken: "tok" }
    );
    expect(f.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(isDeadToken(r.tickets[1])).toBe(true);
    expect(isDeadToken(r.tickets[0])).toBe(false);
    const down = await sendExpoPush([msg], {
      fetchImpl: (async () => {
        throw new Error("x");
      }) as never,
    });
    expect(down).toEqual({ tickets: [null], ok: false });
  });
});

// A tiny in-memory stand-in for the two tables dispatch touches.
function fakeAdmin(
  devices: Record<string, unknown>[],
  sends: Record<string, unknown>[] = []
) {
  const log = { updates: [] as unknown[] };
  const admin = {
    from(table: string) {
      const rows = table === "push_devices" ? devices : sends;
      const state: {
        filters: ((r: Record<string, unknown>) => boolean)[];
        op: string;
        payload?: any;
      } = { filters: [], op: "select" };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (
          state.filters.push((r) => r[c] === v),
          q
        ),
        is: (c: string, v: unknown) => (
          state.filters.push((r) => (r[c] ?? null) === v),
          q
        ),
        in: (c: string, v: unknown[]) => (
          state.filters.push((r) => v.includes(r[c])),
          q
        ),
        gte: (c: string, v: string) => (
          state.filters.push((r) => String(r[c]) >= v),
          q
        ),
        insert: (p: any) => ((state.op = "insert"), (state.payload = p), q),
        update: (p: any) => ((state.op = "update"), (state.payload = p), q),
        single: async () => run(true),
        then: (res: any) => Promise.resolve(run(false)).then(res),
      };
      function run(single: boolean) {
        if (state.op === "insert") {
          if (rows.some((r) => r.dedupe_key === state.payload.dedupe_key)) {
            return { data: null, error: { code: "23505" } };
          }
          const row = {
            id: `s${rows.length + 1}`,
            created_at: new Date().toISOString(),
            ...state.payload,
          };
          rows.push(row);
          return { data: single ? { id: row.id } : [row], error: null };
        }
        const hit = rows.filter((r) => state.filters.every((f) => f(r)));
        if (state.op === "update") {
          hit.forEach((r) => Object.assign(r, state.payload));
          log.updates.push([table, state.payload]);
          return { data: null, error: null };
        }
        return { data: hit, error: null };
      }
      return q;
    },
  };
  return { admin: admin as never, sends, devices, log };
}

const device = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  company_id: "co",
  user_id: "u1",
  expo_token: "ExponentPushToken[a]",
  timezone: "America/Mexico_City",
  daily_enabled: true,
  critical_enabled: true,
  daily_hour: 8,
  quiet_start: 22,
  quiet_end: 7,
  disabled_at: null,
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const ok = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: "ok" }] }),
  });
const call = (
  a: ReturnType<typeof fakeAdmin>,
  over: Record<string, unknown> = {}
) =>
  dispatchPush({
    admin: a.admin,
    companyId: "co",
    userId: "u1",
    category: "critical",
    kind: "invoices_pending",
    dedupeKey: "critical:invoices_pending:u1:a",
    message: invoicesMessage({ lang: "es", count: 2 }),
    now: AT_8,
    fetchImpl: ok() as never,
    enabled: true,
    ...over,
  });

describe("dispatchPush", () => {
  it("does nothing while push is off (no hosted setup yet)", async () => {
    const a = fakeAdmin([device()]);
    expect(await call(a, { enabled: false })).toEqual({ skipped: "off" });
    expect(a.sends).toHaveLength(0);
  });
  it("sends once, records it, and refuses the same key again (duplicate prevention)", async () => {
    const a = fakeAdmin([device()]);
    const f = ok();
    expect(await call(a, { fetchImpl: f })).toEqual({ sent: 1 });
    expect(a.sends[0]).toMatchObject({
      status: "sent",
      dedupe_key: "critical:invoices_pending:u1:a",
    });
    expect(await call(a, { fetchImpl: f })).toEqual({ skipped: "duplicate" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("skips with no device, a disabled category, quiet hours and the cap", async () => {
    expect(await call(fakeAdmin([]))).toEqual({ skipped: "no_device" });
    expect(
      await call(fakeAdmin([device({ critical_enabled: false })]))
    ).toEqual({ skipped: "disabled" });
    expect(await call(fakeAdmin([device()]), { now: AT_23 })).toEqual({
      skipped: "quiet",
    });
    const full = Array.from({ length: DAILY_CAP }, (_, i) => ({
      user_id: "u1",
      status: "sent",
      dedupe_key: `k${i}`,
      created_at: AT_8.toISOString(),
    }));
    expect(await call(fakeAdmin([device()], full))).toEqual({ skipped: "cap" });
  });
  it("ignores another person's device and a disabled one", async () => {
    expect(await call(fakeAdmin([device({ user_id: "u2" })]))).toEqual({
      skipped: "no_device",
    });
    expect(
      await call(fakeAdmin([device({ disabled_at: "2026-11-02T00:00:00Z" })]))
    ).toEqual({ skipped: "no_device" });
  });
  it("turns off a phone Expo says no longer has the app, and logs the failure", async () => {
    const a = fakeAdmin([device()]);
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    });
    expect(await call(a, { fetchImpl: f })).toEqual({ skipped: "failed" });
    expect(a.devices[0].disabled_at).toBeTruthy();
    expect(a.sends[0].status).toBe("failed");
  });
});
