"use client";

// R1-14: when the main sections (and Menú's Ingredientes tab) may be
// prefetched in full, and which save epoch their links carry.
//   * Nothing is prefetched in the first second and a half: the page the
//     person asked for gets the connection and the database first.
//   * After a save the epoch changes (links point at a fresh URL), and
//     prefetching rests for 15 s so a burst of edits does not trigger a
//     burst of full renders.
// Also installs, once, the watcher that bumps the epoch on every
// successful write to /api.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getSaveEpoch,
  installSaveEpochWatcher,
  subscribeSaveEpoch,
} from "@/lib/restaurant/save-epoch";

export const FIRST_WARM_MS = 1500;
export const WARM_AFTER_SAVE_MS = 15_000;

let watching = false;

export function useSectionWarmth(): { epoch: number; warm: boolean } {
  const epoch = useSyncExternalStore(subscribeSaveEpoch, getSaveEpoch, () => 0);
  const [warmFor, setWarmFor] = useState<number | null>(null);

  useEffect(() => {
    if (!watching && typeof window !== "undefined") {
      watching = true;
      installSaveEpochWatcher(window);
    }
  }, []);

  useEffect(() => {
    const wait = epoch === 0 ? FIRST_WARM_MS : WARM_AFTER_SAVE_MS;
    // After the wait, and only once the browser is idle (never in the middle of
    // painting the page the person asked for).
    let idle: number | null = null;
    const timer = setTimeout(() => {
      const ric = (
        window as unknown as {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number }
          ) => number;
        }
      ).requestIdleCallback;
      if (ric) idle = ric(() => setWarmFor(epoch), { timeout: 2000 });
      else setWarmFor(epoch);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (idle !== null) {
        (
          window as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(idle);
      }
    };
  }, [epoch]);

  return { epoch, warm: warmFor === epoch };
}
