// Small hooks of the Gestión screens.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useLanguage } from "../i18n";
import { GESTION, type GestionStrings } from "./strings";

export function useG(): GestionStrings {
  return GESTION[useLanguage()];
}

export interface Loaded<T> {
  data: T | null;
  /** The first read, or a read for a new key (period, month, restaurant). */
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * Loads on mount and whenever `key` changes. A read for another key shows the
 * loading state again (so a period switch never shows the old numbers under the
 * new label). State is only set after the request answers.
 */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [tick, setTick] = useState(0);
  const current = `${key}#${tick}`;
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: unknown;
  } | null>(null);

  useEffect(() => {
    let off = false;
    load().then(
      (data) => {
        if (!off) setResult({ key: current, data, error: null });
      },
      (error) => {
        if (!off) setResult({ key: current, data: null, error });
      }
    );
    return () => {
      off = true;
    };
    // `load` changes every render; `current` is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const fresh = result?.key === current;
  return {
    data: fresh ? result.data : null,
    loading: !fresh,
    error: fresh ? result.error : null,
    reload,
  };
}

/** A plain, translated message for a failed read. Never the server's text. */
export function errorText(err: unknown, g: GestionStrings): string {
  if (err instanceof ApiError && err.offline) return g.errors.offline;
  return g.errors.generic;
}
