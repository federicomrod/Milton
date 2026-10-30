// The cook's own sends, newest first, with what Milton did with each. While a
// text or voice note is still being read, the feed quietly checks again every
// few seconds, so the result shows up on the card by itself.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, friendlyMessage } from "../api/client";
import type { HistoryItem } from "../api/types";
import { useStrings } from "../i18n";
import { awaitsResult, isStuck } from "../lib/result";
import { useSession } from "../session/SessionProvider";
import { reportOffline, useOutbox } from "./outbox";

const POLL_MS = 3_000;

export function useHistoryFeed() {
  const { api } = useSession();
  const s = useStrings();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the cook last tapped «Reintentar» on a stuck card (per history id).
  const [retried, setRetried] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  const sentCount = useOutbox().items.filter((i) => i.state === "sent").length;

  const load = useCallback(
    async (opts: { more?: boolean; quiet?: boolean; pull?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      if (!opts.quiet) setLoading(true);
      try {
        const page = await api.history(opts.more ? cursor : null);
        if (opts.more) {
          setItems((prev) => [
            ...prev,
            ...page.items.filter((i) => !prev.some((p) => p.id === i.id)),
          ]);
          setCursor(page.nextCursor);
        } else {
          // Newer items on top, known ones refreshed in place (keeps scrolled pages).
          setItems((prev) => {
            const fresh = new Map(page.items.map((i) => [i.id, i]));
            const added = page.items.filter(
              (i) => !prev.some((p) => p.id === i.id)
            );
            return [...added, ...prev.map((i) => fresh.get(i.id) ?? i)];
          });
          setCursor((prev) =>
            prev === null && items.length === 0
              ? page.nextCursor
              : (prev ?? page.nextCursor)
          );
        }
        setError(null);
        reportOffline(false);
      } catch (err) {
        if (!opts.quiet) setError(friendlyMessage(err, s.errors));
        if (err instanceof ApiError && err.offline) reportOffline(true);
      } finally {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, cursor, items.length, s]
  );

  // Keep the latest sent-count where the timer can read it (refs are written
  // in effects, never during render).
  const sentRef = useRef(0);
  const seenRef = useRef(0);
  const stuckSeen = useRef(0);
  useEffect(() => {
    sentRef.current = sentCount;
  }, [sentCount]);

  // Every few seconds: a send just reached the server, or a text / voice note
  // is still being read. Either way the card is picked up on its own.
  useEffect(() => {
    const timer = setInterval(() => {
      const fresh = sentRef.current !== seenRef.current;
      seenRef.current = sentRef.current;
      const now = Date.now();
      if (fresh || items.some((i) => awaitsResult(i, now, retried[i.id]))) {
        void load({ quiet: true });
      }
      // A card that crossed the two-minute mark: draw it as «Por enviar» once.
      const stuck = items.filter((i) => isStuck(i, now, retried[i.id])).length;
      if (stuck !== stuckSeen.current) {
        stuckSeen.current = stuck;
        setTick((t) => t + 1);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [items, load, retried]);

  return {
    items,
    loading,
    refreshing,
    error,
    hasMore: cursor !== null,
    /** Changes whenever a card becomes (or stops being) stuck: lists use it as extraData. */
    version: `${tick}:${Object.keys(retried).length}`,
    isStuck: (item: HistoryItem) => isStuck(item, Date.now(), retried[item.id]),
    /**
     * «Reintentar»: the server runs the message again, and the card is checked
     * for another two minutes. Offline, it just looks again later.
     */
    retry: (id: string) => {
      setRetried((prev) => ({ ...prev, [id]: Date.now() }));
      void api
        .retryReport(id)
        .catch(() => undefined)
        .then(() => load({ quiet: true }));
    },
    refresh: () => {
      setRefreshing(true);
      void load({ pull: true });
    },
    reload: () => void load({ quiet: items.length > 0 }),
    loadMore: () => {
      if (cursor) void load({ more: true });
    },
  };
}
