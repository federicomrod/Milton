// lib/restaurant/cockpit-timing.ts
//
// Per-request cockpit timings. Every loader logs `[cockpit-timing] <step>`
// so Fede can grep Vercel logs. The same marks are formatted as a
// Server-Timing header for the browser Network tab.

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

export type CockpitTimingMark = {
  name: string;
  dur: number;
  desc?: string;
};

type TimingStore = { marks: CockpitTimingMark[] };

const als = new AsyncLocalStorage<TimingStore>();

const reactTimingStore = cache((): TimingStore => ({ marks: [] }));

function timingStore(): TimingStore {
  const fromAls = als.getStore();
  if (fromAls) return fromAls;
  const fromReact = reactTimingStore();
  try {
    als.enterWith(fromReact);
  } catch {
    // enterWith is unavailable in some runtimes; logs still work.
  }
  return fromReact;
}

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sanitizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "-");
  return NAME_RE.test(trimmed) ? trimmed : "step";
}

function durationMs(fields: Record<string, unknown>): number | null {
  for (const key of ["ms", "totalMs", "elapsedMs", "rpcMs"] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function formatServerTiming(
  marks: CockpitTimingMark[] = timingStore().marks
): string {
  return marks
    .filter((mark) => Number.isFinite(mark.dur))
    .map((mark) => {
      const dur = Math.max(0, Math.round(mark.dur * 10) / 10);
      const name = sanitizeName(mark.name);
      if (mark.desc && mark.desc.length > 0) {
        const desc = mark.desc.replace(/["\\]/g, "").slice(0, 80);
        return `${name};dur=${dur};desc="${desc}"`;
      }
      return `${name};dur=${dur}`;
    })
    .join(", ");
}

export function recordCockpitTiming(
  name: string,
  dur: number,
  desc?: string
): void {
  if (!Number.isFinite(dur)) return;
  const store = timingStore();
  store.marks.push({
    name: sanitizeName(name),
    dur,
    desc,
  });
}

export function logCockpitTiming(
  label: string,
  fields: Record<string, unknown> = {}
): void {
  const ms = durationMs(fields);
  if (ms != null) {
    const desc =
      typeof fields.desc === "string"
        ? fields.desc
        : typeof fields.source === "string"
          ? fields.source
          : undefined;
    recordCockpitTiming(label, ms, desc);
  }
  console.info(`[cockpit-timing] ${label}`, fields);
}

export async function timeCockpitStep<T>(
  label: string,
  run: () => Promise<T>,
  extra: Record<string, unknown> = {}
): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    logCockpitTiming(label, { ms: Date.now() - started, ...extra });
  }
}

export function applyCockpitServerTimingHeader(): void {
  const header = formatServerTiming();
  if (!header) return;
  const attached = (globalThis as { __miltonServerTimingRes?: SetHeaderLike })
    .__miltonServerTimingRes;
  try {
    attached?.setHeader("Server-Timing", header);
  } catch {
    // Headers may already be sent; Vercel logs still have the split.
  }
}

type SetHeaderLike = {
  setHeader: (name: string, value: string) => unknown;
};

let installed = false;

/** Patch Node ServerResponse so the document request carries Server-Timing. */
export function installCockpitServerTiming(): void {
  if (installed) return;
  installed = true;
  if (typeof process === "undefined") return;
  if (process.env.NEXT_RUNTIME === "edge") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require("node:http") as {
      ServerResponse: {
        prototype: {
          writeHead: (...args: unknown[]) => unknown;
          setHeader: (name: string, value: string) => unknown;
        };
      };
    };
    const proto = http.ServerResponse.prototype;
    const originalWriteHead = proto.writeHead;
    proto.writeHead = function writeHeadWithCockpitTiming(
      this: SetHeaderLike,
      ...args: unknown[]
    ) {
      const header = formatServerTiming();
      if (header) {
        try {
          this.setHeader("Server-Timing", header);
        } catch {
          // ignore
        }
      }
      return originalWriteHead.apply(this, args);
    };
  } catch {
    // Best-effort. Logs remain the source of truth.
  }
}
