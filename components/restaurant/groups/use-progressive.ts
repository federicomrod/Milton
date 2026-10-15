"use client";

// R1-15f: long lists paint their first rows at once and the rest on the next
// frames, so opening a big card never waits for hundreds of rows. Changing
// `resetKey` (filter, sort, search) starts again from the first rows.

import { useCallback, useEffect, useRef, useState } from "react";

export function useProgressiveCount(
  total: number,
  resetKey: string,
  initial = 40,
  step = 80
): number {
  const [state, setState] = useState({ key: resetKey, count: initial });
  const count = state.key === resetKey ? state.count : initial;
  useEffect(() => {
    if (count >= total) return;
    const id = requestAnimationFrame(() =>
      setState({ key: resetKey, count: Math.min(total, count + step) })
    );
    return () => cancelAnimationFrame(id);
  }, [count, total, resetKey, step]);
  return Math.min(count, total);
}

/** A callback with a stable identity that always runs the latest function (keeps memoised rows from re-rendering). */
export function useEventCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
